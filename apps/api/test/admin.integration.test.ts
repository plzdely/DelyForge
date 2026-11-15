import 'dotenv/config';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/create-app';
import { MemoryMailer } from '../src/mail/mailer';
import { PrismaService } from '../src/prisma/prisma.service';

/** Staff tools against real PostgreSQL. Needs DELYFORGE_DB_TESTS=1 + pnpm db:seed. */
const enabled = process.env['DELYFORGE_DB_TESTS'] === '1';

describe.skipIf(!enabled)('admin dashboard (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const run = Date.now().toString(36);
  const email = (n: string) => `${n}-${run}@example.com`;
  const password = 'a long enough password';
  let staff: string;
  let customer: string;

  beforeAll(async () => {
    app = await createApp(loadEnv({ ...process.env, NODE_ENV: 'test' }), { mailer: new MemoryMailer() });
    await app.init();
    prisma = app.get(PrismaService);
    const reg = async (n: string) => `Bearer ${(await http().post('/v1/auth/register').send({ email: email(n), password, displayName: n }).expect(201)).body.accessToken}`;
    staff = await reg('staff');
    customer = await reg('customer');
  });
  afterAll(async () => {
    await app?.close();
  });

  it('is closed to customers and open to staff', async () => {
    await http().get('/v1/admin/overview').set('authorization', staff).expect(403);
    await prisma.user.update({ where: { email: email('staff') }, data: { role: 'SUPPORT' } });
    const overview = await http().get('/v1/admin/overview').set('authorization', staff).expect(200);
    expect(overview.body.users).toBeGreaterThan(0);
    const users = await http().get('/v1/admin/users').query({ q: email('customer') }).set('authorization', staff).expect(200);
    expect(users.body).toMatchObject([{ email: email('customer'), workspace: { planId: 'free' } }]);
    // Support can look but not change.
    await http().post(`/v1/admin/users/${users.body[0].id}/status`).set('authorization', staff).send({ status: 'SUSPENDED', reason: 'test' }).expect(403);
  });

  it('lets admins grant plan extras, then revoke them', async () => {
    await prisma.user.update({ where: { email: email('staff') }, data: { role: 'ADMIN' } });
    const [u] = (await http().get('/v1/admin/users').query({ q: email('customer') }).set('authorization', staff)).body;
    await http().post(`/v1/admin/workspaces/${u.workspace.id}/overrides`).set('authorization', staff).send({ grantFeatures: ['ai.builder'], limits: { aiCreditsPerMonth: 50 }, reason: 'Beta tester', expiresAt: null }).expect(204);
    const ent = await http().get('/v1/entitlements').set('authorization', customer).expect(200);
    expect(ent.body.claims.features).toContain('ai.builder');
    expect(ent.body.claims.limits.aiCreditsPerMonth).toBe(50);
    const [withOverride] = (await http().get('/v1/admin/users').query({ q: email('customer') }).set('authorization', staff)).body;
    await http().delete(`/v1/admin/overrides/${withOverride.overrides[0].id}`).set('authorization', staff).expect(204);
    expect((await http().get('/v1/entitlements').set('authorization', customer)).body.claims.features).not.toContain('ai.builder');
  });

  it('suspends an account (signed out everywhere, can’t sign in) and records it', async () => {
    const [u] = (await http().get('/v1/admin/users').query({ q: email('customer') }).set('authorization', staff)).body;
    await http().post(`/v1/admin/users/${u.id}/status`).set('authorization', staff).send({ status: 'SUSPENDED', reason: 'Abuse report' }).expect(204);
    await http().get('/v1/me').set('authorization', customer).expect(401);
    await http().post('/v1/auth/login').send({ email: email('customer'), password }).expect(403);
    await http().post(`/v1/admin/users/${u.id}/status`).set('authorization', staff).send({ status: 'ACTIVE', reason: 'Resolved' }).expect(204);
    await http().post('/v1/auth/login').send({ email: email('customer'), password }).expect(200);
    const audit = await http().get('/v1/admin/audit').set('authorization', staff).expect(200);
    expect(audit.body.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['admin.user_suspended', 'admin.user_active', 'admin.override_granted']));
  });
});
