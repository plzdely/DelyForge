import 'dotenv/config';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiscordLinkService } from '../src/auth/discord.service';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/create-app';
import { MemoryMailer } from '../src/mail/mailer';
import { PrismaService } from '../src/prisma/prisma.service';

/** Discord linking, bans and staff roles against real PostgreSQL, with a fake Discord. Needs DELYFORGE_DB_TESTS=1. */
const enabled = process.env['DELYFORGE_DB_TESTS'] === '1';

describe.skipIf(!enabled)('Discord linking and bans (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const run = Date.now().toString(36);
  const email = (n: string) => `${n}-${run}@example.com`;
  const password = 'a long enough password';
  // A unique, valid-looking Discord ID per run.
  const discordId = `9${Date.now()}`.padEnd(18, '0').slice(0, 18);
  const fakeUserId = discordId;
  let admin: string;
  let member: string;

  const register = async (n: string) => `Bearer ${(await http().post('/v1/auth/register').send({ email: email(n), password, displayName: n }).expect(201)).body.accessToken}`;
  /** Runs the browser part: start, then Discord "redirects back" with a code. */
  const link = async (auth: string) => {
    const { url } = (await http().post('/v1/me/discord').set('authorization', auth).expect(200)).body as { url: string };
    const state = new URL(url).searchParams.get('state')!;
    return http().get('/v1/auth/discord/callback').query({ code: 'fake-code', state });
  };

  beforeAll(async () => {
    app = await createApp(loadEnv({ ...process.env, NODE_ENV: 'test', DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'secret' }), { mailer: new MemoryMailer() });
    await app.init();
    prisma = app.get(PrismaService);
    app.get(DiscordLinkService).fetchImpl = (async (url: string) => {
      if (String(url).endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'discord-access' }), { status: 200 });
      return new Response(JSON.stringify({ id: fakeUserId, username: 'badguy', global_name: 'Bad Guy', avatar: null }), { status: 200 });
    }) as typeof fetch;
    admin = await register('admin');
    member = await register('member');
    await prisma.user.update({ where: { email: email('admin') }, data: { role: 'ADMIN' } });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('marks the plan certificate until Discord is linked, then links it', async () => {
    expect((await http().get('/v1/entitlements').set('authorization', member)).body.claims.discordOk).toBe(false);
    const { url } = (await http().post('/v1/me/discord').set('authorization', member).expect(200)).body;
    expect(url).toMatch(/^https:\/\/discord\.com\/oauth2\/authorize\?.*scope=identify/);
    const page = await link(member);
    expect(page.text).toContain('Discord connected');
    expect((await http().get('/v1/me').set('authorization', member)).body.discord).toMatchObject({ id: discordId, username: 'Bad Guy' });
    expect((await http().get('/v1/entitlements').set('authorization', member)).body.claims.discordOk).toBe(true);
  });

  it('refuses reused links and a Discord account already linked elsewhere', async () => {
    const { url } = (await http().post('/v1/me/discord').set('authorization', admin).expect(200)).body;
    const state = new URL(url).searchParams.get('state')!;
    expect((await http().get('/v1/auth/discord/callback').query({ code: 'c', state })).text).toContain('already linked to another');
    expect((await http().get('/v1/auth/discord/callback').query({ code: 'c', state })).text).toContain('expired');
  });

  it('a ban blocks the account, its email and its Discord account; unbanning lifts all three', async () => {
    const [u] = (await http().get('/v1/admin/users').query({ q: discordId }).set('authorization', admin).expect(200)).body;
    expect(u.discord).toMatchObject({ id: discordId });
    await http().post(`/v1/admin/users/${u.id}/status`).set('authorization', admin).send({ status: 'SUSPENDED', reason: 'Spamming' }).expect(204);
    await http().get('/v1/me').set('authorization', member).expect(401);
    await http().post('/v1/auth/login').send({ email: email('member'), password }).expect(403);
    await http().post('/v1/auth/register').send({ email: email('member').toUpperCase(), password, displayName: 'again' }).expect(403);

    // A brand-new account can't link the banned Discord account either.
    const fresh = await register('fresh');
    expect((await link(fresh)).text).toContain('can’t be used with DelyForge');

    await http().post(`/v1/admin/users/${u.id}/status`).set('authorization', admin).send({ status: 'ACTIVE', reason: 'Appeal accepted' }).expect(204);
    await http().post('/v1/auth/login').send({ email: email('member'), password }).expect(200);
    expect(await prisma.ban.count({ where: { userId: u.id } })).toBe(0);
  });

  it('lets admins give and remove staff access, but not their own', async () => {
    const [u] = (await http().get('/v1/admin/users').query({ q: email('fresh') }).set('authorization', admin)).body;
    const [me] = (await http().get('/v1/admin/users').query({ q: email('admin') }).set('authorization', admin)).body;
    await http().post(`/v1/admin/users/${u.id}/role`).set('authorization', admin).send({ role: 'SUPPORT' }).expect(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('SUPPORT');
    await http().post(`/v1/admin/users/${me.id}/role`).set('authorization', admin).send({ role: 'USER' }).expect(400);
  });
});
