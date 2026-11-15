import 'dotenv/config';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import Stripe from 'stripe';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/create-app';
import { MemoryMailer } from '../src/mail/mailer';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Full account + billing flow against a real PostgreSQL database.
 * Run with: DELYFORGE_DB_TESTS=1 pnpm --filter @delyforge/api test   (needs pnpm db:up, db:migrate, db:seed)
 */
const enabled = process.env['DELYFORGE_DB_TESTS'] === '1';
const WEBHOOK_SECRET = 'whsec_test_secret_for_signature_checks';

describe.skipIf(!enabled)('accounts and billing (PostgreSQL)', () => {
  let app: INestApplication;
  const mailer = new MemoryMailer();
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'a long enough password';
  const http = () => request(app.getHttpServer());
  const tokenFrom = (text: string) => /token=([\w-]+)/.exec(text)?.[1] ?? '';

  beforeAll(async () => {
    app = await createApp(
      loadEnv({ ...process.env, NODE_ENV: 'test', STRIPE_SECRET_KEY: 'sk_test_not_a_real_key', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
      { mailer },
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  let tokens: { accessToken: string; refreshToken: string };

  it('registers, creates a workspace and sends a verification email', async () => {
    const res = await http().post('/v1/auth/register').send({ email: email.toUpperCase(), password, displayName: 'Dely' }).expect(201);
    tokens = res.body;
    expect(tokens.accessToken).toBeTruthy();
    expect(mailer.sent.at(-1)?.to).toBe(email); // normalised to lowercase

    const me = await http().get('/v1/me').set('authorization', `Bearer ${tokens.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ email, emailVerified: false, displayName: 'Dely' });
    expect(me.body.workspace.id).toBeTruthy();
  });

  it('refuses a duplicate account and weak passwords', async () => {
    await http().post('/v1/auth/register').send({ email, password, displayName: 'X' }).expect(409);
    await http().post('/v1/auth/register').send({ email: `x${email}`, password: 'short', displayName: 'X' }).expect(422);
  });

  it('verifies the email from the link (once)', async () => {
    const token = tokenFrom(mailer.sent.at(-1)!.text);
    const page = await http().get(`/v1/auth/verify-email?token=${token}`).expect(200);
    expect(page.text).toContain('Email confirmed');
    expect((await http().get(`/v1/auth/verify-email?token=${token}`)).text).toContain('expired');
    const me = await http().get('/v1/me').set('authorization', `Bearer ${tokens.accessToken}`);
    expect(me.body.emailVerified).toBe(true);
  });

  it('rejects wrong passwords with a generic message', async () => {
    const res = await http().post('/v1/auth/login').send({ email, password: 'wrong password!!' }).expect(401);
    expect(res.body.error.message).toBe('Email or password is incorrect.');
    await http().post('/v1/auth/login').send({ email: 'nobody@example.com', password: 'wrong password!!' }).expect(401);
  });

  it('rotates refresh tokens and treats reuse of an old one as theft', async () => {
    const login = await http().post('/v1/auth/login').send({ email, password, deviceName: 'Test PC' }).expect(200);
    const first = login.body.refreshToken as string;
    const rotated = await http().post('/v1/auth/refresh').send({ refreshToken: first }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(first);
    // Reusing the old token revokes the whole family — including the newest token.
    await http().post('/v1/auth/refresh').send({ refreshToken: first }).expect(401);
    await http().post('/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
    await http().get('/v1/me').set('authorization', `Bearer ${rotated.body.accessToken}`).expect(401);
  });

  it('signs out immediately on logout', async () => {
    const login = await http().post('/v1/auth/login').send({ email, password }).expect(200);
    await http().post('/v1/auth/logout').set('authorization', `Bearer ${login.body.accessToken}`).expect(204);
    await http().get('/v1/me').set('authorization', `Bearer ${login.body.accessToken}`).expect(401);
  });

  it('resets a forgotten password and signs out every device', async () => {
    await http().post('/v1/auth/forgot-password').send({ email }).expect(202);
    await http().post('/v1/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(202); // same answer
    const token = tokenFrom(mailer.sent.at(-1)!.text);
    const res = await http().post('/v1/auth/reset-password').type('form').send({ token, password: 'my new long password' }).expect(200);
    expect(res.text).toContain('Password changed');
    await http().get('/v1/me').set('authorization', `Bearer ${tokens.accessToken}`).expect(401);
    const login = await http().post('/v1/auth/login').send({ email, password: 'my new long password' }).expect(200);
    tokens = login.body;
  });

  it('issues a signed Free plan certificate, then Pro after a verified Stripe webhook', async () => {
    const free = await http().get('/v1/entitlements').set('authorization', `Bearer ${tokens.accessToken}`).expect(200);
    expect(free.body.claims).toMatchObject({ effectivePlanId: 'free', reason: 'free_plan' });
    expect(free.body.token.split('.')).toHaveLength(2);
    const workspaceId = free.body.claims.sub as string;

    // The plan is taken from the Stripe price, so the Pro monthly price needs a Stripe ID (kept if one is already set).
    const prisma = app.get(PrismaService);
    const proMonthly = await prisma.planPrice.findFirstOrThrow({ where: { planId: 'pro', interval: 'MONTH', active: true } });
    const priceId = proMonthly.stripePriceId ?? 'price_test_pro_month';
    if (!proMonthly.stripePriceId) await prisma.planPrice.update({ where: { id: proMonthly.id }, data: { stripePriceId: priceId } });

    const now = Math.floor(Date.now() / 1000);
    const event = {
      id: `evt_test_${Date.now()}`,
      object: 'event',
      created: now,
      type: 'customer.subscription.created',
      data: {
        object: {
          id: `sub_test_${Date.now()}`,
          object: 'subscription',
          status: 'active',
          metadata: { workspaceId, planId: 'business' }, // ignored: the price decides the plan
          cancel_at_period_end: false,
          canceled_at: null,
          trial_end: null,
          items: { data: [{ price: { id: priceId, recurring: { interval: 'month' } }, current_period_start: now, current_period_end: now + 30 * 86400 }] },
        },
      },
    };
    const payload = JSON.stringify(event);
    const stripe = new Stripe('sk_test_not_a_real_key');

    // A forged webhook is refused.
    await http().post('/v1/billing/webhook').set('stripe-signature', 't=1,v1=forged').set('content-type', 'application/json').send(payload).expect(400);

    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    await http().post('/v1/billing/webhook').set('stripe-signature', signature).set('content-type', 'application/json').send(payload).expect(200);
    // The same event again is acknowledged but not re-applied.
    const dup = await http().post('/v1/billing/webhook').set('stripe-signature', signature).set('content-type', 'application/json').send(payload).expect(200);
    expect(dup.body.duplicate).toBe(true);

    // An older event delivered late must not overwrite the newer state.
    const stale = JSON.stringify({ ...event, id: `${event.id}_old`, created: now - 600, data: { object: { ...event.data.object, status: 'canceled' } } });
    await http().post('/v1/billing/webhook').set('stripe-signature', stripe.webhooks.generateTestHeaderString({ payload: stale, secret: WEBHOOK_SECRET })).set('content-type', 'application/json').send(stale).expect(200);

    const pro = await http().get('/v1/entitlements').set('authorization', `Bearer ${tokens.accessToken}`).expect(200);
    expect(pro.body.claims).toMatchObject({ effectivePlanId: 'pro', reason: 'active' });
    expect(pro.body.claims.features).toContain('ai.builder');
  });

  it('protects private routes', async () => {
    await http().get('/v1/me').expect(401);
    await http().get('/v1/entitlements').set('authorization', 'Bearer not-a-token').expect(401);
  });
});
