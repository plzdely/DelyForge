import 'dotenv/config';
import 'reflect-metadata';
import { createPublicKey, verify } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { base64UrlDecode, packageSigningInput } from '@delyforge/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/create-app';
import { MemoryMailer } from '../src/mail/mailer';
import { PrismaService } from '../src/prisma/prisma.service';

/** Marketplace flow against real PostgreSQL. Needs DELYFORGE_DB_TESTS=1 + pnpm db:seed. */
const enabled = process.env['DELYFORGE_DB_TESTS'] === '1';

const COMMAND = { id: 'i1', enabled: true, type: 'slash', name: 'rules', description: 'Show the rules', options: [], access: 'everyone', cooldownSeconds: 0, response: { text: 'Be nice', embedId: '', ephemeral: false, buttons: [] } };

describe.skipIf(!enabled)('marketplace (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const run = Date.now().toString(36);
  const slug = `rules-pack-${run}`;
  let dev: string;
  let buyer: string;
  let buyerWorkspace: string;

  const account = async (name: string) => {
    const res = await http().post('/v1/auth/register').send({ email: `${name}-${run}@example.com`, password: 'a long enough password', displayName: name }).expect(201);
    return `Bearer ${res.body.accessToken}`;
  };
  const submit = (content: unknown, version = '1.0.0') =>
    http()
      .post('/v1/marketplace/developer/listings')
      .set('authorization', dev)
      .send({ slug, type: 'COMMAND_PACK', title: 'Rules pack', summary: 'A /rules command for any server.', description: '', category: 'Utility', tags: ['Rules'], version, changelog: '', content });

  beforeAll(async () => {
    app = await createApp(loadEnv({ ...process.env, NODE_ENV: 'test' }), { mailer: new MemoryMailer() });
    await app.init();
    prisma = app.get(PrismaService);
    dev = await account('dev');
    buyer = await account('buyer');
    buyerWorkspace = (await http().get('/v1/me').set('authorization', buyer)).body.workspace.id;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('requires a developer profile and checks every package', async () => {
    await submit({ modules: {}, commands: [COMMAND], embeds: [], workflows: [] }).expect(403);
    await http().post('/v1/marketplace/developer').set('authorization', dev).send({ displayName: 'Dev', slug: `dev-${run}` }).expect(201);
    const withId = { modules: {}, commands: [], embeds: [], workflows: [{ id: 'i1', name: 'Role', enabled: true, trigger: { type: 'memberJoin' }, steps: [{ type: 'addRole', roleId: '300000000000000001' }] }] };
    expect((await submit(withId).expect(422)).body.error.message).toContain('IDs');
    const res = await submit({ modules: {}, commands: [COMMAND], embeds: [], workflows: [] }).expect(201);
    expect(res.body).toMatchObject({ slug, status: 'IN_REVIEW', versions: [{ version: '1.0.0', reviewStatus: 'PENDING' }] });
    await http().get(`/v1/marketplace/listings/${slug}`).expect(404); // not public until approved
  });

  it('lets only staff review, and signs what they approve', async () => {
    await http().get('/v1/marketplace/review-queue').set('authorization', dev).expect(403);
    const devUser = await prisma.user.findFirstOrThrow({ where: { email: `dev-${run}@example.com` } });
    await prisma.user.update({ where: { id: devUser.id }, data: { role: 'ADMIN' } });
    const queue = await http().get('/v1/marketplace/review-queue').set('authorization', dev).expect(200);
    const item = (queue.body as { slug: string; versionId: string }[]).find((q) => q.slug === slug)!;
    await http().post(`/v1/marketplace/review-queue/${item.versionId}`).set('authorization', dev).send({ approve: true, notes: '' }).expect(204);
    await http().post(`/v1/marketplace/review-queue/${item.versionId}`).set('authorization', dev).send({ approve: true, notes: '' }).expect(404);

    const list = await http().get('/v1/marketplace/listings').query({ q: 'rules' }).expect(200);
    expect(list.body.map((l: { slug: string }) => l.slug)).toContain(slug);
    const detail = await http().get(`/v1/marketplace/listings/${slug}`).expect(200);
    expect(detail.body.contents.commands).toEqual(['/rules']);
  });

  it('installs on a plan with marketplace access, with a valid DelyForge signature', async () => {
    await http().post(`/v1/marketplace/listings/${slug}/install`).set('authorization', buyer).expect(403); // Free plan
    await http().post(`/v1/marketplace/listings/${slug}/reviews`).set('authorization', buyer).send({ rating: 5, body: '' }).expect(403); // not installed
    await prisma.subscription.create({ data: { workspaceId: buyerWorkspace, planId: 'pro', status: 'ACTIVE', interval: 'MONTH', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
    const pkg = await http().post(`/v1/marketplace/listings/${slug}/install`).set('authorization', buyer).expect(201);
    const { publicKey } = (await http().get('/v1/entitlements/public-key')).body;
    expect(verify(null, Buffer.from(packageSigningInput(pkg.body.payload)), createPublicKey(publicKey), Buffer.from(base64UrlDecode(pkg.body.signature)))).toBe(true);
    expect(JSON.parse(pkg.body.payload).content.commands[0].name).toBe('rules');
    await http().post(`/v1/marketplace/listings/${slug}/install`).set('authorization', buyer).expect(201); // reinstall doesn't double-count
    expect((await http().get(`/v1/marketplace/listings/${slug}`)).body.downloads).toBe(1);
  });

  it('accepts reviews from people who installed it', async () => {
    await http().post(`/v1/marketplace/listings/${slug}/reviews`).set('authorization', buyer).send({ rating: 4, body: 'Handy' }).expect(204);
    const detail = await http().get(`/v1/marketplace/listings/${slug}`).expect(200);
    expect(detail.body).toMatchObject({ ratingAvg: 4, ratingCount: 1, reviews: [{ rating: 4, body: 'Handy', author: 'buyer' }] });
  });
});
