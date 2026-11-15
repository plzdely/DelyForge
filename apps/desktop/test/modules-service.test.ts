import { describe, expect, it } from 'vitest';
import { DEFAULT_MODULE_CONFIGS, createBotProjectSchema, resolveEntitlements } from '@delyforge/shared';
import { BotRepository } from '../src/main/db/bots';
import { openDatabase } from '../src/main/db/database';
import { ActivityRepository } from '../src/main/db/repositories';
import { SecretRepository } from '../src/main/db/secrets';
import { DiscordApi } from '../src/main/discord-api';
import { AppError } from '../src/main/errors';
import { ModulesService } from '../src/main/runtime/modules-service';

const G = '123456789012345678';

function setup(plan: 'free' | 'pro') {
  const db = openDatabase(':memory:');
  const activity = new ActivityRepository(db);
  const ent = resolveEntitlements(plan === 'pro' ? { planId: 'pro', status: 'active' } : { planId: 'free', status: 'none' });
  const bots = new BotRepository(db, activity, () => ent);
  const secrets = new SecretRepository(db, { isAvailable: () => true, encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() });
  let restart = false;
  const service = new ModulesService(bots, secrets, new DiscordApi('0', 'http://127.0.0.1:1'), activity, () => ent, () => restart);
  const id = bots.create(createBotProjectSchema.parse({ name: 'Aurora' })).id;
  return { service, bots, activity, id, setRestart: (v: boolean) => (restart = v) };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return null;
};

describe('ModulesService', () => {
  it('saves valid settings per server and records activity', () => {
    const { service, activity, id } = setup('free');
    const res = service.update(id, G, 'welcome', { ...DEFAULT_MODULE_CONFIGS.welcome, enabled: true });
    expect(res.modules[G]?.welcome?.enabled).toBe(true);
    expect(service.get(id)[G]?.welcome?.enabled).toBe(true);
    expect(activity.recent(1)[0]?.message).toBe('Enabled Welcome for “Aurora”');
  });

  it('keeps settings for different servers separate', () => {
    const { service, id } = setup('free');
    const other = '223456789012345678';
    service.update(id, G, 'utility', { ...DEFAULT_MODULE_CONFIGS.utility, enabled: true });
    service.update(id, other, 'utility', { ...DEFAULT_MODULE_CONFIGS.utility, enabled: false });
    expect(service.get(id)[G]?.utility?.enabled).toBe(true);
    expect(service.get(id)[other]?.utility?.enabled).toBe(false);
  });

  it('rejects invalid settings with a helpful message', () => {
    const { service, id } = setup('pro');
    let err: AppError | undefined;
    try {
      service.update(id, G, 'welcome', { ...DEFAULT_MODULE_CONFIGS.welcome, welcome: { ...DEFAULT_MODULE_CONFIGS.welcome.welcome, message: 'x'.repeat(2001) } });
    } catch (e) {
      err = e as AppError;
    }
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.message).toMatch(/2000 characters.*welcome\.message/);
  });

  it('enforces the plan: Pro modules and auto-moderation are locked on Free', () => {
    const { service, id } = setup('free');
    expect(code(() => service.update(id, G, 'logging', { ...DEFAULT_MODULE_CONFIGS.logging, enabled: true }))).toBe('FORBIDDEN');
    const automod = { ...DEFAULT_MODULE_CONFIGS.moderation, enabled: true, automod: { ...DEFAULT_MODULE_CONFIGS.moderation.automod, enabled: true } };
    expect(code(() => service.update(id, G, 'moderation', automod))).toBe('FORBIDDEN');
    // Saving a disabled Pro module (keeping settings) is fine.
    expect(code(() => service.update(id, G, 'logging', DEFAULT_MODULE_CONFIGS.logging))).toBeNull();
  });

  it('allows everything on Pro and reports when a restart is needed', () => {
    const { service, id, setRestart } = setup('pro');
    setRestart(true);
    const res = service.update(id, G, 'logging', { ...DEFAULT_MODULE_CONFIGS.logging, enabled: true });
    expect(res.restartRequired).toBe(true);
  });

  it('refuses to load server structure for an unconnected bot', async () => {
    const { service, id } = setup('pro');
    await expect(service.guilds(id)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
