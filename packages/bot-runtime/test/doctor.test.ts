import { DEFAULT_MODULE_CONFIGS, resolveGuildModules } from '@delyforge/shared';
import { describe, expect, it } from 'vitest';
import { type DoctorInput, diagnose } from '../src/modules/doctor.js';

const VIEW = 1n << 10n, SEND = 1n << 11n, EMBED = 1n << 14n, ROLES = 1n << 28n;
const C = '111111111111111111', GONE = '222222222222222222', LOW = '333333333333333333', HIGH = '444444444444444444';

function input(patch: Partial<DoctorInput> = {}): DoctorInput {
  return {
    guildName: 'Aurora',
    configs: resolveGuildModules({}),
    botPermissions: VIEW | SEND | EMBED | ROLES,
    botRolePosition: 5,
    channel: (id) => (id === C ? { name: 'general', kind: 'text', perms: VIEW | SEND | EMBED } : null),
    role: (id) => (id === LOW ? { name: 'Member', position: 1, managed: false } : id === HIGH ? { name: 'Admin', position: 9, managed: false } : null),
    ...patch,
  };
}

describe('Setup Doctor', () => {
  it('finds nothing wrong when modules are off', () => {
    expect(diagnose(input())).toEqual([]);
  });

  it('explains deleted channels, missing channels, roles the bot can’t give and missing rights', () => {
    const configs = resolveGuildModules({
      welcome: { ...DEFAULT_MODULE_CONFIGS.welcome, enabled: true, welcome: { ...DEFAULT_MODULE_CONFIGS.welcome.welcome, channelId: GONE }, autoRoles: { ...DEFAULT_MODULE_CONFIGS.welcome.autoRoles, roleIds: [LOW, HIGH] } },
      starboard: { ...DEFAULT_MODULE_CONFIGS.starboard, enabled: true },
      leveling: { ...DEFAULT_MODULE_CONFIGS.leveling, enabled: true, noXpRoleIds: [HIGH] },
    });
    const titles = diagnose(input({ configs })).map((i) => i.title);
    expect(titles.some((t) => /uses a channel that was deleted/.test(t))).toBe(true);
    expect(titles.some((t) => /can’t give @Admin/.test(t))).toBe(true);
    expect(titles.some((t) => /no starboard channel chosen/.test(t))).toBe(true);
    expect(titles.some((t) => /Member/.test(t))).toBe(false); // below the bot's role: fine
    expect(titles.filter((t) => /Admin/.test(t))).toHaveLength(1); // the no-XP list isn't a role to give
  });

  it('checks the bot’s rights in each chosen channel, unless it is an administrator', () => {
    const configs = resolveGuildModules({ birthdays: { ...DEFAULT_MODULE_CONFIGS.birthdays, enabled: true, channelId: C } });
    const locked = input({ configs, channel: () => ({ name: 'general', kind: 'text', perms: VIEW }) });
    expect(diagnose(locked).map((i) => i.title)).toEqual([expect.stringMatching(/can’t use #general \(missing Send Messages, Embed Links\)/)]);
    expect(diagnose({ ...locked, botPermissions: 1n << 3n })).toEqual([]);
  });
});
