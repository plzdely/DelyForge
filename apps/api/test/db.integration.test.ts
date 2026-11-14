import 'dotenv/config';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { DEFAULT_PLANS } from '@delyforge/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/create-app';

/**
 * Runs against a real PostgreSQL database (migrated + seeded).
 * Enable with: DELYFORGE_DB_TESTS=1 pnpm --filter @delyforge/api test
 * Requires: pnpm db:up && pnpm db:migrate && pnpm db:seed
 */
const enabled = process.env['DELYFORGE_DB_TESTS'] === '1';

describe.skipIf(!enabled)('API with PostgreSQL', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(loadEnv({ ...process.env, NODE_ENV: 'test' }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports the database as up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.checks.database).toBe('up');
  });

  it('serves the seeded plan catalogue with the published prices', async () => {
    const res = await request(app.getHttpServer()).get('/v1/plans').expect(200);
    const plans = res.body.plans as { id: string; prices: { interval: string; amountCents: number }[] }[];
    expect(plans.map((p) => p.id)).toEqual(['free', 'pro', 'business', 'enterprise']);
    const pro = plans.find((p) => p.id === 'pro')!;
    expect(pro.prices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ interval: 'month', amountCents: DEFAULT_PLANS.pro.pricing!.monthlyUsdCents }),
        expect.objectContaining({ interval: 'year', amountCents: DEFAULT_PLANS.pro.pricing!.annualUsdCents }),
      ]),
    );
  });
});
