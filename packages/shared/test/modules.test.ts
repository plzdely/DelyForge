import { describe, expect, it } from 'vitest';
import {
  BASE_INTENTS,
  DEFAULT_MODULE_CONFIGS,
  INTENT_BITS,
  applyEntitlementsToModules,
  botModulesSchema,
  guildModulesSchema,
  computeIntents,
  containsInvite,
  disallowedLinks,
  levelFromXp,
  xpToNextLevel,
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

  it('loads logging settings saved before newer events existed (no settings are lost)', () => {
    const old = { enabled: true, channelId: null, ignoredChannelIds: [], events: { messageDelete: true, messageEdit: false, memberJoin: true, memberLeave: true, memberRoles: true, channels: true, bans: true, voice: false } };
    const parsed = guildModulesSchema.parse({ logging: old });
    expect(parsed.logging).toMatchObject({ channelOverrides: {}, events: { messageEdit: false, roles: true, server: true, voice: false } });
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
    expect(renderTemplate('{option:max_count} {var:joins}', { 'option:max_count': 5, 'var:joins': '12' })).toBe('5 12');
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

describe('link filter bypasses (security review)', () => {
  it('uses the real hostname, not text after it', () => {
    const allowed = ['youtube.com'];
    expect(disallowedLinks('https://evil.com?x.youtube.com', allowed)).toEqual(['evil.com']);
    expect(disallowedLinks('https://evil.com#.youtube.com', allowed)).toEqual(['evil.com']);
    expect(disallowedLinks('https://youtube.com@evil.com/watch', allowed)).toEqual(['evil.com']);
    expect(disallowedLinks('https://www.youtube.com./watch', allowed)).toEqual([]);
  });

  it('never treats an empty allow-list entry as "allow everything"', () => {
    expect(disallowedLinks('https://evil.com', [''])).toEqual(['evil.com']);
    expect(moduleConfigSchemas.moderation.safeParse({
      ...DEFAULT_MODULE_CONFIGS.moderation,
      automod: { ...DEFAULT_MODULE_CONFIGS.moderation.automod, links: { enabled: true, allowedDomains: [''], action: 'delete' } },
    }).success).toBe(false);
  });
});

describe('leveling maths', () => {
  it('follows the familiar curve', () => {
    expect(xpToNextLevel(0)).toBe(100);
    expect(xpToNextLevel(1)).toBe(155);
    expect(levelFromXp(0)).toEqual({ level: 0, current: 0, needed: 100 });
    expect(levelFromXp(99).level).toBe(0);
    expect(levelFromXp(100)).toEqual({ level: 1, current: 0, needed: 155 });
    expect(levelFromXp(255)).toEqual({ level: 2, current: 0, needed: 220 });
  });

  it('rejects min XP above max XP', () => {
    expect(moduleConfigSchemas.leveling.safeParse({ ...DEFAULT_MODULE_CONFIGS.leveling, xpMin: 50, xpMax: 10 }).success).toBe(false);
  });
});

describe('reaction role panels', () => {
  const panel = { id: 'games', channelId: null, title: 'Games', description: '', color: '#7c5cff', mode: 'buttons' as const, multiple: true, roles: [{ roleId: G, label: 'Minecraft', emoji: '⛏️' }] };

  it('accepts a valid panel and rejects duplicate panel IDs or empty panels', () => {
    const schema = moduleConfigSchemas.reactionRoles;
    expect(schema.safeParse({ enabled: true, panels: [panel] }).success).toBe(true);
    expect(schema.safeParse({ enabled: true, panels: [panel, panel] }).success).toBe(false);
    expect(schema.safeParse({ enabled: true, panels: [{ ...panel, roles: [] }] }).success).toBe(false);
  });
});

describe('more auto-moderation checks (0.3)', () => {
  it('spots fake Discord/Steam links but leaves real ones alone', async () => {
    const { scamLinks } = await import('../src/modules.js');
    expect(scamLinks('free nitro https://dlscord-nitro.gift/claim')).toEqual(['dlscord-nitro.gift']);
    expect(scamLinks('trade me https://steamcornmunity.com/tradeoffer')).toEqual(['steamcornmunity.com']);
    expect(scamLinks('https://discord.com/channels/1 https://discord.gg/abc https://discords.com/bots https://youtube.com/watch')).toEqual([]);
  });

  it('counts caps and emoji', async () => {
    const { isCapsSpam, countEmoji } = await import('../src/modules.js');
    expect(isCapsSpam('WHY IS NOBODY ANSWERING ME', 10, 70)).toBe(true);
    expect(isCapsSpam('OK', 10, 70)).toBe(false);
    expect(isCapsSpam('Normal sentence here', 10, 70)).toBe(false);
    expect(countEmoji('hi 😀😀 <:pog:123456789012345678> 👍')).toBe(4);
  });

  it('loads moderation settings saved before the new filters existed', () => {
    const old = JSON.parse(JSON.stringify(DEFAULT_MODULE_CONFIGS.moderation)) as { automod: Record<string, unknown> };
    for (const k of ['caps', 'mentions', 'emoji', 'scams', 'repeats']) delete old.automod[k];
    const parsed = guildModulesSchema.parse({ moderation: old });
    expect(parsed.moderation?.automod).toMatchObject({ scams: { enabled: true }, mentions: { max: 5 } });
  });
});

describe('settings saved by older versions keep loading (v0.4 options)', () => {
  it('fills in the new welcome, verification and role-panel options', () => {
    const old = JSON.parse(JSON.stringify(DEFAULT_MODULE_CONFIGS));
    delete old.welcome.welcome.buttons;
    delete old.welcome.welcome.style.imageUrl;
    delete old.welcome.goodbye.embed;
    delete old.welcome.goodbye.color;
    old.welcome.autoRoles = { roleIds: [] };
    delete old.welcome.pingChannelIds;
    for (const k of ['logChannelId', 'challenge', 'kickAfterHours', 'dmMessage']) delete old.verification[k];
    const welcome = moduleConfigSchemas.welcome.parse(old.welcome);
    expect(welcome.autoRoles).toEqual({ roleIds: [], botRoleIds: [], delayMinutes: 0 });
    expect(welcome.welcome.buttons).toEqual([]);
    expect(moduleConfigSchemas.verification.parse(old.verification)).toMatchObject({ challenge: 'none', kickAfterHours: 0, dmMessage: '', logChannelId: null });
    const panel = { id: 'p1', channelId: null, title: 'Roles', description: '', color: '#7c5cff', mode: 'buttons', multiple: true, roles: [{ roleId: '123456789012345678', label: 'A', emoji: '' }] };
    expect(moduleConfigSchemas.reactionRoles.parse({ enabled: true, panels: [panel] }).panels[0]).toMatchObject({ oneRoleOnly: false, requiredRoleId: null });
  });
});
