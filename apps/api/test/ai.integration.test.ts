import 'dotenv/config';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { AiBuilderOutput } from '@delyforge/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiTextProvider } from '../src/ai/provider';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/create-app';
import { MemoryMailer } from '../src/mail/mailer';
import { PrismaService } from '../src/prisma/prisma.service';

/** AI gateway against real PostgreSQL with a fake provider (no AI key, no cost). Needs DELYFORGE_DB_TESTS=1 + pnpm db:seed. */
const enabled = process.env['DELYFORGE_DB_TESTS'] === '1';

const GUILD = { id: '100000000000000001', name: 'Test', channels: [{ id: '200000000000000001', name: 'welcome', kind: 'text' }], roles: [] };
const OUTPUT: AiBuilderOutput = {
  summary: 'Welcomes new members in #welcome.',
  modules: [{ moduleId: 'welcome', settingsJson: JSON.stringify({ enabled: true, welcome: { enabled: true, channelId: '200000000000000001' } }) }],
  commandsJson: [],
  workflowsJson: [],
  notes: [],
};

describe.skipIf(!enabled)('AI gateway (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fail = false;
  let refuse = false;
  const calls: string[] = [];
  const fake: AiTextProvider = {
    id: 'anthropic',
    async complete(req) {
      calls.push(req.model);
      if (fail) throw new Error('provider down');
      await new Promise((ok) => setTimeout(ok, 50));
      if (refuse) return { output: null, inputTokens: 4000, outputTokens: 200, refused: true };
      const output = 'modules' in (req.schema as { shape?: object }).shape! ? OUTPUT : { summary: 'Token reset', likelyCause: 'Invalid token', steps: ['Reconnect'] };
      return { output, inputTokens: 4000, outputTokens: 2000, refused: false };
    },
  };
  const http = () => request(app.getHttpServer());
  let auth: string;
  let workspaceId: string;

  beforeAll(async () => {
    app = await createApp(loadEnv({ ...process.env, NODE_ENV: 'test' }), { mailer: new MemoryMailer(), aiProviders: { anthropic: fake } });
    await app.init();
    prisma = app.get(PrismaService);
    const email = `ai-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const res = await http().post('/v1/auth/register').send({ email, password: 'a long enough password', displayName: 'AI' }).expect(201);
    auth = `Bearer ${res.body.accessToken}`;
    workspaceId = (await http().get('/v1/me').set('authorization', auth)).body.workspace.id;
  });
  afterAll(async () => {
    await app?.close();
  });

  const troubleshoot = () =>
    http().post('/v1/ai/troubleshoot').set('authorization', auth).send({ question: '', botName: 'Bot', status: 'error', lastError: 'TOKEN_INVALID', logs: ['login failed'] });
  const build = () => http().post('/v1/ai/bot-builder').set('authorization', auth).send({ prompt: 'Welcome new people please', guild: GUILD });

  it('is refused on the Free plan', async () => {
    await build().expect(403);
    expect(calls).toHaveLength(0);
  });

  it('returns a validated proposal on Pro and meters credits', async () => {
    await prisma.subscription.create({ data: { workspaceId, planId: 'pro', status: 'ACTIVE', interval: 'MONTH', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
    const res = await build().expect(201);
    expect(res.body.proposal.modules[0]).toMatchObject({ moduleId: 'welcome', config: { enabled: true } });
    expect(res.body.creditsUsed).toBe(7);
    expect(res.body.usage).toMatchObject({ configured: true, used: 7, limit: 300 });
    expect(calls).toEqual(['claude-opus-5-5']);

    // Decided once, by its owner.
    await http().post(`/v1/ai/proposals/${res.body.proposalId}/decision`).set('authorization', auth).send({ decision: 'applied' }).expect(204);
    await http().post(`/v1/ai/proposals/${res.body.proposalId}/decision`).set('authorization', auth).send({ decision: 'rejected' }).expect(404);
  });

  it('does not charge when the provider fails', async () => {
    fail = true;
    await build().expect(503);
    fail = false;
    const usage = await http().get('/v1/ai/usage').set('authorization', auth).expect(200);
    expect(usage.body.used).toBe(7);
  });

  it('answers troubleshooting questions', async () => {
    const res = await http()
      .post('/v1/ai/troubleshoot')
      .set('authorization', auth)
      .send({ question: '', botName: 'Bot', status: 'error', lastError: 'TOKEN_INVALID', logs: ['login failed'] })
      .expect(201);
    expect(res.body.answer.likelyCause).toBe('Invalid token');
  });

  it('charges for answers the AI generated even when it declined', async () => {
    const before = (await http().get('/v1/ai/usage').set('authorization', auth)).body.used as number;
    refuse = true;
    await build().expect(422);
    refuse = false;
    const after = (await http().get('/v1/ai/usage').set('authorization', auth)).body.used as number;
    expect(after - before).toBe(3);
  });

  it('lets only one of several simultaneous requests through at the limit', async () => {
    const model = await prisma.aiModel.findFirstOrThrow({ where: { modelKey: 'claude-opus-5-5' } });
    const userId = (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).ownerId;
    const used = (await http().get('/v1/ai/usage').set('authorization', auth)).body.used as number;
    await prisma.aiUsage.create({ data: { workspaceId, userId, modelId: model.id, feature: 'builder', inputTokens: 0, outputTokens: 0, credits: 299 - used, costMicroCents: 0, success: true } });
    // Troubleshooting has its own rate limit, so this doesn't trip the builder's 6-per-minute limit.
    const results = await Promise.all([troubleshoot(), troubleshoot(), troubleshoot()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 403, 403]);
  });

  it('stops when the monthly credits are used up', async () => {
    const model = await prisma.aiModel.findFirstOrThrow({ where: { modelKey: 'claude-opus-5-5' } });
    const userId = (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).ownerId;
    await prisma.aiUsage.create({ data: { workspaceId, userId, modelId: model.id, feature: 'builder', inputTokens: 0, outputTokens: 0, credits: 300, costMicroCents: 0, success: true } });
    const res = await troubleshoot().expect(403);
    expect(res.body.error.message).toContain('AI credits');
  });
});
