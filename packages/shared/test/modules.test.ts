import { describe, expect, it } from 'vitest';
import {
  BASE_INTENTS,
  DEFAULT_MODULE_CONFIGS,
  INTENT_BITS,
  applyEntitlementsToModules,
  botModulesSchema,
  computeIntents,
  containsInvite,
  disallowedLinks,
  matchBlockedWord,
  moduleConfigSchemas,
  recordMessageAndCheckSpam,
  renderTemplate,
  resolveEntitlements,
  thresholdFor,
} from '../src/index.js';

const G = '123456789012345678';
const on = <T extends { enabled: boolean }>(c: T): T => ({ ...c, enabled: true });

describe('module schemas', () => {
  it('accept their own defaults', () => {
    for (const [id, schema] of Object.entries(moduleConfigSchemas)) {
      const parsed = schema.safeParse(DEFAULT_MODULE_CONFIGS[id as keyof typeof DEFAULT_MODULE_CONFIGS]);
      expect(parsed.success, id).toBe(true);
    }
  });

  it('reject unknown keys, bad IDs and bad colours', () => {
    expect(moduleConfigSchemas.welcome.safeParse({ ...DEFAULT_MODULE_CONFIGS.welcome, script: 'x' }).success).toBe(false);
    expect(
      moduleConfigSchemas.welcome.safeParse({
        ...DEFAULT_MODULE_CONFIGS.welcome,
        welcome: { ...DEFAULT_MODULE_CONFIGS.welcome.welcome, channelId: 'general' },
      }).success,
    ).toBe(false);
    expect(
      moduleConfigSchemas.welcome.safeParse({
        ...DEFAULT_MODULE_CONFIGS.welcome,
        welcome: { ...DEFAULT_MODULE_CONFIGS.welcome.welcome, style: { embed: true, color: 'purple', title: '' } },
      }).success,
    ).toBe(false);
    expect(botModulesSchema.safeParse({ 'not-a-guild': {} }).success).toBe(false);
  });
});

describe('computeIntents', () => {
  it('needs only Guilds with nothing enabled', () => {
    expect(computeIntents({})).toBe(BASE_INTENTS);
    expect(computeIntents({ [G]: { utility: on(DEFAULT_MODULE_CONFIGS.utility) } })).toBe(BASE_INTENTS);
  });

  it('adds Server Members for welcome and message intents for auto-moderation', () => {
    const intents = computeIntents({
      [G]: {
        welcome: on(DEFAULT_MODULE_CONFIGS.welcome),
        moderation: { ...on(DEFAULT_MODULE_CONFIGS.moderation), automod: on(DEFAULT_MODULE_CONFIGS.moderation.automod) },
      },
    });
    for (const k of ['Guilds', 'GuildMembers', 'GuildMessages', 'MessageContent']) {
      expect(intents & INTENT_BITS[k]!, k).not.toBe(0);
    }
  });

  it('only asks logging for what its enabled events need', () => {
    const events = Object.fromEntries(Object.keys(DEFAULT_MODULE_CONFIGS.logging.events).map((k) => [k, false])) as typeof DEFAULT_MODULE_CONFIGS.logging.events;
    const intents = computeIntents({ [G]: { logging: { ...on(DEFAULT_MODULE_CONFIGS.logging), events: { ...events, bans: true } } } });
    expect(intents).toBe(BASE_INTENTS | INTENT_BITS['GuildModeration']!);
  });
});

describe('applyEntitlementsToModules', () => {
  const modules = {
    [G]: {
      welcome: on(DEFAULT_MODULE_CONFIGS.welcome),
      logging: on(DEFAULT_MODULE_CONFIGS.logging),
      moderation: { ...on(DEFAULT_MODULE_CONFIGS.moderation), automod: on(DEFAULT_MODULE_CONFIGS.moderation.automod) },
    },
  };

  it('keeps everything on Pro', () => {
    const pro = resolveEntitlements({ planId: 'pro', status: 'active' }).features;
    expect(applyEntitlementsToModules(modules, pro)).toEqual(modules);
  });

  it('switches off Pro modules and auto-moderation on Free, keeping the settings', () => {
    const free = resolveEntitlements({ planId: 'free', status: 'none' }).features;
    const out = applyEntitlementsToModules(modules, free)[G]!;
    expect(out.welcome?.enabled).toBe(true);
    expect(out.logging?.enabled).toBe(false);
    expect(out.logging?.channelId).toBe(modules[G].logging.channelId);
    expect(out.moderation?.enabled).toBe(true);
    expect(out.moderation?.automod.enabled).toBe(false);
  });
});

describe('templates', () => {
  it('fills variables and leaves unknown ones visible', () => {
    expect(renderTemplate('Hi {user}, welcome to {server} (#{memberCount}) {oops}', { user: '<@1>', server: 'Aurora', memberCount: 42 })).toBe(
      'Hi <@1>, welcome to Aurora (#42) {oops}',
    );
    expect(renderTemplate('{user.name}', { 'user.name': 'Dely' })).toBe('Dely');
  });
});

describe('auto-moderation checks', () => {
  it('detects Discord invites', () => {
    expect(containsInvite('join discord.gg/abc123 now')).toBe(true);
    expect(containsInvite('https://discord.com/invite/xyz')).toBe(true);
    expect(containsInvite('discord is great')).toBe(false);
  });

  it('allows listed domains and their subdomains only', () => {
    expect(disallowedLinks('see https://www.youtube.com/watch?v=1 and https://evil.example/x', ['youtube.com'])).toEqual(['evil.example']);
    expect(disallowedLinks('https://notyoutube.com', ['youtube.com'])).toEqual(['notyoutube.com']);
    expect(disallowedLinks('no links here', [])).toEqual([]);
  });

  it('matches blocked words as whole words and simple evasions', () => {
    expect(matchBlockedWord('That is BADWORD!', ['badword'])).toBe('badword');
    expect(matchBlockedWord('b.a.d.w.o.r.d', ['badword'])).toBe('badword');
    expect(matchBlockedWord('class', ['ass'])).toBeNull();
    expect(matchBlockedWord('fine message', ['badword'])).toBeNull();
  });

  it('detects message bursts in a sliding window', () => {
    const ts: number[] = [];
    const results = [0, 100, 200, 300, 400].map((t) => recordMessageAndCheckSpam(ts, t, 4, 5));
    expect(results).toEqual([false, false, false, false, true]);
    expect(recordMessageAndCheckSpam(ts, 20_000, 4, 5)).toBe(false);
  });

  it('picks the strongest action for a warning count', () => {
    const t = [
      { warnings: 3, action: 'timeout' as const, minutes: 60 },
      { warnings: 5, action: 'kick' as const, minutes: 1 },
      { warnings: 5, action: 'ban' as const, minutes: 1 },
    ];
    expect(thresholdFor(t, 3)?.action).toBe('timeout');
    expect(thresholdFor(t, 4)).toBeNull();
    expect(thresholdFor(t, 5)?.action).toBe('ban');
  });
});
