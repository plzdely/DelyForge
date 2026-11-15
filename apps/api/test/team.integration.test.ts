import 'dotenv/config';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/create-app';
import { MemoryMailer } from '../src/mail/mailer';
import { PrismaService } from '../src/prisma/prisma.service';

/** Team workspaces against real PostgreSQL. Needs DELYFORGE_DB_TESTS=1 + pnpm db:seed. */
const enabled = process.env['DELYFORGE_DB_TESTS'] === '1';

describe.skipIf(!enabled)('team workspaces (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const mailer = new MemoryMailer();
  const http = () => request(app.getHttpServer());
  const run = Date.now().toString(36);
  const email = (n: string) => `${n}-${run}@example.com`;
  let owner: string;
  let member: { accessToken: string; refreshToken: string };
  let teamId: string;

  const register = async (name: string) => (await http().post('/v1/auth/register').send({ email: email(name), password: 'a long enough password', displayName: name }).expect(201)).body;

  beforeAll(async () => {
    app = await createApp(loadEnv({ ...process.env, NODE_ENV: 'test' }), { mailer });
    await app.init();
    prisma = app.get(PrismaService);
    owner = `Bearer ${(await register('owner')).accessToken}`;
    teamId = (await http().get('/v1/me').set('authorization', owner)).body.workspace.id;
    member = await register('member');
  });
  afterAll(async () => {
    await app?.close();
  });

  it('needs the Business plan to invite', async () => {
    await http().post('/v1/team/invites').set('authorization', owner).send({ email: email('member'), role: 'DEVELOPER' }).expect(403);
    await prisma.subscription.create({ data: { workspaceId: teamId, planId: 'business', status: 'ACTIVE', interval: 'MONTH', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
    await http().post('/v1/team/invites').set('authorization', owner).send({ email: email('MEMBER'), role: 'DEVELOPER' }).expect(204);
    expect(mailer.sent.at(-1)).toMatchObject({ to: email('member') });
    const info = await http().get('/v1/team').set('authorization', owner).expect(200);
    expect(info.body).toMatchObject({ canManage: true, seats: { used: 2, limit: 5 }, invites: [{ email: email('member'), role: 'DEVELOPER' }] });
  });

  it('accepts only with a confirmed email, once, then switches the device to the team plan', async () => {
    const auth = `Bearer ${member.accessToken}`;
    expect((await http().get('/v1/team/my-invites').set('authorization', auth).expect(200)).body).toEqual([]);
    const invite = await prisma.workspaceInvite.findFirstOrThrow({ where: { workspaceId: teamId, email: email('member') } });
    await http().post(`/v1/team/my-invites/${invite.id}/accept`).set('authorization', auth).expect(403); // email not confirmed
    await prisma.user.update({ where: { email: email('member') }, data: { emailVerifiedAt: new Date() } });
    expect((await http().get('/v1/team/my-invites').set('authorization', auth)).body).toHaveLength(1);
    const accepted = await http().post(`/v1/team/my-invites/${invite.id}/accept`).set('authorization', auth).expect(200);
    expect(accepted.body.workspaceId).toBe(teamId);
    await http().post(`/v1/team/my-invites/${invite.id}/accept`).set('authorization', auth).expect(404);

    const switched = await http().post('/v1/team/switch').set('authorization', auth).send({ workspaceId: teamId }).expect(200);
    member = switched.body;
    // Members share the team plan but can't buy or replace it.
    await http().post('/v1/billing/checkout').set('authorization', `Bearer ${member.accessToken}`).send({ planId: 'pro', interval: 'month' }).expect(403);
    const me = await http().get('/v1/me').set('authorization', `Bearer ${member.accessToken}`).expect(200);
    expect(me.body.workspace.id).toBe(teamId);
    const ent = await http().get('/v1/entitlements').set('authorization', `Bearer ${member.accessToken}`).expect(200);
    expect(ent.body.claims.effectivePlanId).toBe('business');
    // The active workspace survives a token refresh.
    const refreshed = await http().post('/v1/auth/refresh').send({ refreshToken: member.refreshToken }).expect(200);
    member = refreshed.body;
    expect((await http().get('/v1/me').set('authorization', `Bearer ${member.accessToken}`)).body.workspace.id).toBe(teamId);
  });

  it('only managers remove people, and a removed member falls back to their own workspace', async () => {
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: email('member') } });
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: email('owner') } });
    await http().delete(`/v1/team/members/${ownerUser.id}`).set('authorization', `Bearer ${member.accessToken}`).expect(400);
    await http().post('/v1/team/switch').set('authorization', owner).send({ workspaceId: 'not-mine' }).expect(403);
    await http().delete(`/v1/team/members/${memberUser.id}`).set('authorization', owner).expect(204);
    // The member's current access token for the team stops working immediately.
    await http().get('/v1/team').set('authorization', `Bearer ${member.accessToken}`).expect(401);
    const refreshed = await http().post('/v1/auth/refresh').send({ refreshToken: member.refreshToken }).expect(200);
    const me = await http().get('/v1/me').set('authorization', `Bearer ${refreshed.body.accessToken}`).expect(200);
    expect(me.body.workspace.id).not.toBe(teamId);
    await http().get('/v1/team').set('authorization', `Bearer ${refreshed.body.accessToken}`).expect(200);
  });

  it('counts pending invites against the seat limit', async () => {
    for (let i = 1; i <= 4; i++) await http().post('/v1/team/invites').set('authorization', owner).send({ email: email(`p${i}`), role: 'VIEWER' }).expect(204);
    await http().post('/v1/team/invites').set('authorization', owner).send({ email: email('p5'), role: 'VIEWER' }).expect(403);
  });
});
