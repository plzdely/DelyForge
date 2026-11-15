import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/create-app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * HTTP-level tests with the database replaced by an in-memory fake, so they run without PostgreSQL.
 * Database-backed tests live in db.integration.test.ts.
 */
const fakePlans = [
  {
    id: 'free',
    name: 'Free',
    tagline: 't',
    rank: 0,
    limits: { maxBotProjects: 1 },
    features: ['modules.basic'],
    highlights: ['1 bot project'],
    prices: [
      { interval: 'MONTH', amountCents: 0, currency: 'usd' },
      { interval: 'YEAR', amountCents: 0, currency: 'usd' },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 't',
    rank: 3,
    limits: { maxBotProjects: null },
    features: [],
    highlights: [],
    prices: [],
  },
];

let dbHealthy = true;

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused:unused@localhost:1/unused',
  CORS_ORIGINS: 'http://localhost:5173',
  JWT_SECRET: 'test-secret-test-secret-test-secret-123',
});

let app: INestApplication;

beforeAll(async () => {
  app = await createApp(env);
  const prisma = app.get(PrismaService);
  // Replace database access with fakes.
  Object.assign(prisma, {
    isHealthy: async () => dbHealthy,
    plan: { findMany: async () => fakePlans },
  });
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('GET /health', () => {
  it('reports ok when the database is up', async () => {
    dbHealthy = true;
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'delyforge-api', checks: { database: 'up' } });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns 503 when the database is down', async () => {
    dbHealthy = false;
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body.checks.database).toBe('down');
    dbHealthy = true;
  });

  it('sets security headers', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /v1/plans', () => {
  it('returns plans with normalized prices', async () => {
    const res = await request(app.getHttpServer()).get('/v1/plans').expect(200);
    expect(res.body.plans).toHaveLength(2);
    expect(res.body.plans[0].prices).toEqual([
      { interval: 'month', amountCents: 0, currency: 'usd' },
      { interval: 'year', amountCents: 0, currency: 'usd' },
    ]);
    expect(res.body.plans[1].customPricing).toBe(true);
  });
});

describe('errors', () => {
  it('returns the standard error envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/does-not-exist').expect(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('echoes a well-formed request id and ignores malformed ones', async () => {
    const good = await request(app.getHttpServer()).get('/health').set('x-request-id', 'abc12345-test');
    expect(good.headers['x-request-id']).toBe('abc12345-test');
    const bad = await request(app.getHttpServer()).get('/health').set('x-request-id', '<script>');
    expect(bad.headers['x-request-id']).not.toBe('<script>');
  });
});

describe('configuration', () => {
  it('rejects a missing or non-PostgreSQL DATABASE_URL without printing values', () => {
    const jwt = { JWT_SECRET: 'x'.repeat(40) };
    expect(() => loadEnv({ ...jwt })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...jwt, DATABASE_URL: 'mysql://secret-password@host/db' })).toThrow(/PostgreSQL/);
    try {
      loadEnv({ ...jwt, DATABASE_URL: 'mysql://secret-password@host/db' });
    } catch (e) {
      expect((e as Error).message).not.toContain('secret-password');
    }
  });
});
