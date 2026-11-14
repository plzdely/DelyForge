import { describe, expect, it } from 'vitest';
import { BOT_EXPORT_FORMAT, createBotProjectSchema, resolveEntitlements } from '@delyforge/shared';
import { BotRepository } from '../src/main/db/bots';
import { openDatabase } from '../src/main/db/database';
import { ActivityRepository } from '../src/main/db/repositories';
import { createEntitlementsProvider } from '../src/main/entitlements';
import { AppError } from '../src/main/errors';

function setup(plan: 'free' | 'pro' = 'pro') {
  const db = openDatabase(':memory:');
  const activity = new ActivityRepository(db);
  const ent = resolveEntitlements(plan === 'free' ? { planId: 'free', status: 'none' } : { planId: 'pro', status: 'active' });
  const repo = new BotRepository(db, activity, () => ent);
  const create = (name: string, extra: Record<string, unknown> = {}) =>
    repo.create(createBotProjectSchema.parse({ name, ...extra }));
  return { db, activity, repo, create };
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : 'UNEXPECTED';
  }
  return undefined;
}

describe('BotRepository — CRUD', () => {
  it('creates a project with sensible defaults and records activity', () => {
    const { repo, activity, create } = setup();
    const bot = create('Aurora', { description: 'Gaming helper', groupName: 'Gaming' });
    expect(bot).toMatchObject({
      name: 'Aurora',
      description: 'Gaming helper',
      groupName: 'Gaming',
      isFavorite: false,
      isEnabled: true,
      hasToken: false,
      discordApplicationId: null,
    });
    expect(bot.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(repo.list()).toHaveLength(1);
    expect(activity.recent(1)[0]?.message).toContain('Aurora');
  });

  it('updates fields, favorites and records renames', () => {
    const { repo, activity, create } = setup();
    const bot = create('Aurora');
    const updated = repo.update({ id: bot.id, patch: { name: 'Nova', isFavorite: true, groupName: null } });
    expect(updated).toMatchObject({ name: 'Nova', isFavorite: true, groupName: null });
    expect(activity.recent(1)[0]?.message).toBe('Renamed “Aurora” to “Nova”');
  });

  it('returns NOT_FOUND for missing projects', () => {
    const { repo } = setup();
    const missing = '3b241101-e2bb-4255-8caf-4136c566a962';
    expect(errorCode(() => repo.get(missing))).toBe('NOT_FOUND');
    expect(errorCode(() => repo.remove(missing))).toBe('NOT_FOUND');
  });

  it('deletes a project together with its stored token', () => {
    const { db, repo, create } = setup();
    const bot = create('Aurora');
    db.prepare('INSERT INTO bot_secrets (bot_id, encrypted_token) VALUES (?, ?)').run(bot.id, Buffer.from('x'));
    expect(repo.get(bot.id).hasToken).toBe(true);
    repo.remove(bot.id);
    expect(repo.list()).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bot_secrets').get()).toEqual({ n: 0 });
  });
});

describe('BotRepository — duplicate', () => {
  it('copies configuration but never the token or Discord application', () => {
    const { db, repo, create } = setup();
    const bot = create('Aurora', { groupName: 'Gaming' });
    db.prepare(`UPDATE bot_projects SET config = '{"modules":{"welcome":true}}', discord_application_id = '123456789012345678' WHERE id = ?`).run(bot.id);
    db.prepare('INSERT INTO bot_secrets (bot_id, encrypted_token) VALUES (?, ?)').run(bot.id, Buffer.from('x'));

    const copy = repo.duplicate(bot.id);
    expect(copy).toMatchObject({ name: 'Aurora (copy)', groupName: 'Gaming', hasToken: false, discordApplicationId: null });
    const row = db.prepare('SELECT config FROM bot_projects WHERE id = ?').get(copy.id) as { config: string };
    expect(JSON.parse(row.config)).toEqual({ modules: { welcome: true } });
  });

  it('generates unique copy names', () => {
    const { repo, create } = setup();
    const bot = create('Aurora');
    expect(repo.duplicate(bot.id).name).toBe('Aurora (copy)');
    expect(repo.duplicate(bot.id).name).toBe('Aurora (copy 2)');
    const copy = repo.list().find((b) => b.name === 'Aurora (copy)')!;
    expect(repo.duplicate(copy.id).name).toBe('Aurora (copy 3)');
  });

  it('keeps copy names within the 32 character limit', () => {
    const { repo, create } = setup();
    const bot = create('A'.repeat(32));
    expect(repo.duplicate(bot.id).name.length).toBeLessThanOrEqual(32);
  });
});

describe('BotRepository — plan limits', () => {
  it('blocks create, duplicate and import beyond the Free plan limit', () => {
    const { repo, create } = setup('free');
    const bot = create('Aurora');
    expect(errorCode(() => create('Second'))).toBe('LIMIT_REACHED');
    expect(errorCode(() => repo.duplicate(bot.id))).toBe('LIMIT_REACHED');
    const file = JSON.stringify(repo.exportProject(bot.id, '0.2.0'));
    expect(errorCode(() => repo.importProject(file))).toBe('LIMIT_REACHED');
    expect(repo.count()).toBe(1);
  });

  it('never deletes projects that exceed the limit after a downgrade', () => {
    const db = openDatabase(':memory:');
    const activity = new ActivityRepository(db);
    let plan: 'pro' | 'free' = 'pro';
    const repo = new BotRepository(db, activity, () =>
      resolveEntitlements(plan === 'pro' ? { planId: 'pro', status: 'active' } : { planId: 'free', status: 'none' }),
    );
    for (const n of ['A', 'B', 'C']) repo.create(createBotProjectSchema.parse({ name: n }));
    plan = 'free';
    expect(repo.list()).toHaveLength(3);
    expect(errorCode(() => repo.create(createBotProjectSchema.parse({ name: 'D' })))).toBe('LIMIT_REACHED');
  });
});

describe('BotRepository — export / import', () => {
  it('round-trips a project without any token', () => {
    const { db, repo, create } = setup();
    const bot = create('Aurora', { description: 'Hi', groupName: 'Gaming' });
    db.prepare('INSERT INTO bot_secrets (bot_id, encrypted_token) VALUES (?, ?)').run(bot.id, Buffer.from('secret'));
    const exported = repo.exportProject(bot.id, '0.2.0');
    const text = JSON.stringify(exported);
    expect(exported.format).toBe(BOT_EXPORT_FORMAT);
    expect(text).not.toMatch(/token|secret/i);

    const imported = repo.importProject(text);
    expect(imported).toMatchObject({ name: 'Aurora (imported)', description: 'Hi', groupName: 'Gaming', hasToken: false });
  });

  it('keeps the original name when there is no conflict', () => {
    const { repo, create } = setup();
    const bot = create('Aurora');
    const text = JSON.stringify(repo.exportProject(bot.id, '0.2.0'));
    repo.remove(bot.id);
    expect(repo.importProject(text).name).toBe('Aurora');
  });

  it('rejects invalid, foreign, tampered and oversized files with a clear message', () => {
    const { repo, create } = setup();
    const bot = create('Aurora');
    const good = repo.exportProject(bot.id, '0.2.0');
    const cases = [
      'not json at all',
      JSON.stringify({ hello: 'world' }),
      JSON.stringify({ ...good, project: { ...good.project, token: 'MTAx.abc.def' } }),
      JSON.stringify({ ...good, version: 99 }),
      JSON.stringify({ ...good, project: { ...good.project, name: '' } }),
      'x'.repeat(1024 * 1024 + 1),
    ];
    for (const text of cases) {
      let err: unknown;
      try {
        repo.importProject(text);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('VALIDATION_FAILED');
      expect((err as AppError).message).toMatch(/DelyForge bot export/);
    }
    expect(repo.count()).toBe(1);
  });
});

describe('entitlements provider', () => {
  it('uses the Free plan by default', () => {
    const get = createEntitlementsProvider({ isPackaged: false, devPlan: undefined });
    expect(get()).toMatchObject({ effectivePlanId: 'free', source: 'local' });
  });

  it('honours the development plan override only in unpackaged builds', () => {
    expect(createEntitlementsProvider({ isPackaged: false, devPlan: 'business' })()).toMatchObject({
      effectivePlanId: 'business',
      source: 'dev-override',
    });
    expect(createEntitlementsProvider({ isPackaged: true, devPlan: 'business' })()).toMatchObject({
      effectivePlanId: 'free',
      source: 'local',
    });
    expect(createEntitlementsProvider({ isPackaged: false, devPlan: 'platinum' })().effectivePlanId).toBe('free');
  });
});
