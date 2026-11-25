import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MODULE_CONFIGS, resolveGuildModules } from '@delyforge/shared';
import { describe, expect, it } from 'vitest';
import { recordJoin } from '../src/modules/antiraid.js';
import { daysUntil, dueBirthdays, isBirthdayToday, validBirthday } from '../src/modules/birthdays.js';
import { desiredCommands } from '../src/modules/commands.js';
import { findUsedInvite } from '../src/modules/invites.js';
import { audienceFits, emojiMatches } from '../src/modules/starboard.js';
import { statName } from '../src/modules/stats.js';
import { tempChannelName } from '../src/modules/tempvoice.js';
import { BotStore } from '../src/store.js';

const snap = (entries: [string, number, string | null][]) => new Map(entries.map(([code, uses, inviterId]) => [code, { uses, inviterId }]));

describe('invite tracker', () => {
  it('finds the invite whose use count went up', () => {
    expect(findUsedInvite(snap([['abc', 2, 'A'], ['xyz', 5, 'B']]), snap([['abc', 2, 'A'], ['xyz', 6, 'B']]))).toEqual({ code: 'xyz', inviterId: 'B' });
  });

  it('recognises a one-use invite that disappeared, and gives up when unsure', () => {
    expect(findUsedInvite(snap([['once', 0, 'A'], ['xyz', 5, 'B']]), snap([['xyz', 5, 'B']]))).toEqual({ code: 'once', inviterId: 'A' });
    expect(findUsedInvite(snap([['a', 0, 'A'], ['b', 0, 'B']]), snap([]))).toBeNull();
  });

  it('counts invites that stayed and left, and remembers who invited whom', () => {
    const store = new BotStore(join(mkdtempSync(join(tmpdir(), 'df-inv-')), 'b.db'));
    store.recordInviteJoin('g', 'u1', 'A', 'abc');
    store.recordInviteJoin('g', 'u2', 'A', 'abc');
    expect(store.recordInviteJoin('g', 'u3', 'A', 'abc')).toBe(3);
    store.recordInviteLeave('g', 'u2');
    expect(store.inviteCounts('g', 'A')).toEqual({ stayed: 2, left: 1 });
    expect(store.invitedBy('g', 'u1')).toEqual({ inviterId: 'A', code: 'abc' });
    expect(store.inviteLeaderboard('g')).toEqual([{ inviterId: 'A', stayed: 2, left: 1 }]);
    store.close();
  });
});

describe('starboard', () => {
  it('matches normal and server emojis', () => {
    expect(emojiMatches('⭐', { id: null, name: '⭐' })).toBe(true);
    expect(emojiMatches('⭐', { id: null, name: '🔥' })).toBe(false);
    expect(emojiMatches('<:pog:123456789012345678>', { id: '123456789012345678', name: 'pog' })).toBe(true);
    expect(emojiMatches('<:pog:123456789012345678>', { id: '999', name: 'pog' })).toBe(false);
  });

  it('only copies a message to a starboard whose audience is no bigger than the source channel’s', () => {
    const roles = ['everyone', 'member', 'mod'];
    const sees = (...who: string[]) => (r: string) => who.includes(r);
    // Staff channel (mods only) → members' starboard: refused.
    expect(audienceFits(roles, sees('member', 'mod'), sees('mod'))).toBe(false);
    // Members' channel → members' starboard: fine.
    expect(audienceFits(roles, sees('member', 'mod'), sees('member', 'mod'))).toBe(true);
    // Public channel → staff-only starboard: fine.
    expect(audienceFits(roles, sees('mod'), sees('everyone', 'member', 'mod'))).toBe(true);
  });
});

describe('raid protection', () => {
  it('counts joins inside the window only', () => {
    const t = 1_000_000;
    for (let n = 0; n < 4; n++) recordJoin('raid-g', `u${n}`, t + n * 1000, 10);
    expect(recordJoin('raid-g', 'u4', t + 4000, 10)).toHaveLength(5);
    expect(recordJoin('raid-g', 'u5', t + 60_000, 10)).toHaveLength(1);
  });
});

describe('names and counters', () => {
  it('builds temporary channel names and stats counters', () => {
    expect(tempChannelName('{user}’s channel', 'Ana')).toBe('Ana’s channel');
    expect(tempChannelName('x'.repeat(150), 'Ana')).toHaveLength(100);
    expect(statName('Members: {members} · Bots: {bots}', { members: 120, humans: 110, bots: 10, boosts: 2, channels: 30, roles: 8 })).toBe('Members: 120 · Bots: 10');
  });
});

describe('birthdays', () => {
  const at = (iso: string) => new Date(iso);

  it('validates dates and celebrates 29 February on the 28th in other years', () => {
    expect(validBirthday(2, 29)).toBe(true);
    expect(validBirthday(4, 31)).toBe(false);
    expect(isBirthdayToday(2, 29, at('2027-02-28T10:00:00Z'))).toBe(true);
    expect(isBirthdayToday(2, 29, at('2028-02-28T10:00:00Z'))).toBe(false);
    expect(isBirthdayToday(2, 29, at('2028-02-29T10:00:00Z'))).toBe(true);
  });

  it('announces once a year, after the chosen hour', () => {
    const list = [
      { userId: 'a', month: 11, day: 25, announcedYear: null },
      { userId: 'b', month: 11, day: 25, announcedYear: 2026 },
      { userId: 'c', month: 11, day: 26, announcedYear: null },
    ];
    expect(dueBirthdays(list, at('2026-11-25T08:00:00Z'), 9)).toEqual([]);
    expect(dueBirthdays(list, at('2026-11-25T09:30:00Z'), 9)).toEqual(['a']);
    expect(daysUntil(11, 26, at('2026-11-25T12:00:00Z'))).toBe(1);
    expect(daysUntil(11, 24, at('2026-11-25T12:00:00Z'))).toBe(364);
  });
});

describe('slash commands', () => {
  it('adds /invites, /inviteboard and /birthday only when those modules are on', () => {
    const names = (c: ReturnType<typeof resolveGuildModules>) => desiredCommands(c).map((d) => d.name);
    expect(names(resolveGuildModules({}))).not.toContain('invites');
    const on = resolveGuildModules({ invites: { ...DEFAULT_MODULE_CONFIGS.invites, enabled: true }, birthdays: { ...DEFAULT_MODULE_CONFIGS.birthdays, enabled: true } });
    expect(names(on)).toEqual(expect.arrayContaining(['invites', 'inviteboard', 'birthday']));
  });
});
