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

describe('moderation cases and temporary bans', () => {
  it('numbers cases per server and lists a member’s history newest first', () => {
    const store = new BotStore(join(mkdtempSync(join(tmpdir(), 'df-case-')), 'b.db'));
    expect(store.addCase({ guildId: 'g', type: 'warn', userId: 'u', moderatorId: 'm', reason: 'spam' })).toBe(1);
    expect(store.addCase({ guildId: 'g', type: 'tempban', userId: 'u', moderatorId: 'm', reason: 'again', duration: '3d' })).toBe(2);
    expect(store.addCase({ guildId: 'other', type: 'kick', userId: 'u', moderatorId: 'm', reason: 'x' })).toBe(1);
    expect(store.cases('g', 'u').map((c) => c.number)).toEqual([2, 1]);
    expect(store.caseByNumber('g', 2)).toMatchObject({ type: 'tempban', duration: '3d' });
    store.close();
  });

  it('lifts temporary bans only when their time is up', () => {
    const store = new BotStore(join(mkdtempSync(join(tmpdir(), 'df-tb-')), 'b.db'));
    store.addTempBan('g', 'u1', 1000);
    store.addTempBan('g', 'u2', 5000);
    expect(store.dueTempBans(2000)).toEqual([{ guildId: 'g', userId: 'u1' }]);
    store.removeTempBan('g', 'u1');
    expect(store.dueTempBans(2000)).toEqual([]);
    store.close();
  });
});

describe('social alerts', () => {
  it('reads YouTube (Atom) and normal RSS feeds', async () => {
    const { parseFeed, youtubeChannelId } = await import('../src/modules/feeds.js');
    const atom = `<feed><title>Cool Channel</title><entry><id>yt:video:abc</id><yt:videoId>abc</yt:videoId><title>New &amp; shiny</title>
      <link rel="alternate" href="https://www.youtube.com/watch?v=abc"/><author><name>Cool Channel</name></author></entry></feed>`;
    expect(parseFeed(atom)).toEqual([{ id: 'abc', title: 'New & shiny', link: 'https://www.youtube.com/watch?v=abc', author: 'Cool Channel' }]);
    const rss = `<rss><channel><title>Blog</title><item><title><![CDATA[Post 1]]></title><link>https://blog.example/1</link><guid>p1</guid></item></channel></rss>`;
    expect(parseFeed(rss)).toEqual([{ id: 'p1', title: 'Post 1', link: 'https://blog.example/1', author: 'Blog' }]);
    expect(youtubeChannelId('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv')).toBe('UCabcdefghijklmnopqrstuv');
    expect(youtubeChannelId('https://youtube.com/@someone')).toBeNull();
    // A hostile feed (endless unclosed tags) is read quickly, and at most 15 items count.
    const start = Date.now();
    expect(parseFeed('<entry <link '.repeat(80_000))).toEqual([]);
    expect(parseFeed('<rss>' + '<item><guid>x</guid><link>https://a.b/</link></item>'.repeat(50))).toHaveLength(15);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('remembers a feed’s existing posts on the first check, then only new ones count', () => {
    const store = new BotStore(join(mkdtempSync(join(tmpdir(), 'df-feed-')), 'b.db'));
    expect(store.seenFeedItems('g', 'rss:x')).toBeNull();
    store.markFeedItemsSeen('g', 'rss:x', ['a', 'b']);
    expect([...store.seenFeedItems('g', 'rss:x')!]).toEqual(['a', 'b']);
    store.markFeedItemsSeen('g', 'rss:empty', []);
    expect(store.seenFeedItems('g', 'rss:empty')).not.toBeNull();
    store.close();
  });
});

describe('scheduled messages', () => {
  it('works out the local day and time in a time zone, with summer time', async () => {
    const { localParts, dueMessages } = await import('../src/modules/scheduled.js');
    // 14:30 UTC on Wed 15 July 2026 is 09:30 in Chicago (summer time, UTC-5).
    expect(localParts(new Date('2026-07-15T14:30:00Z'), 'America/Chicago')).toEqual({ day: 3, time: '09:30', date: '2026-07-15' });
    // In winter the same UTC time is 08:30 there (UTC-6).
    expect(localParts(new Date('2026-01-14T14:30:00Z'), 'America/Chicago')?.time).toBe('08:30');
    expect(localParts(new Date(), 'Not/AZone')).toBeNull();
    const msgs = [
      { channelId: '1', text: 'daily', days: [], time: '09:30', roleId: null },
      { channelId: '1', text: 'mondays', days: [1], time: '09:30', roleId: null },
    ];
    expect(dueMessages(msgs, { day: 3, time: '09:30' })).toEqual([0]);
    expect(dueMessages(msgs, { day: 1, time: '09:30' })).toEqual([0, 1]);
  });
});

describe('channel lock memory', () => {
  it('remembers what /lock changed so /unlock can restore it', () => {
    const store = new BotStore(join(mkdtempSync(join(tmpdir(), 'df-lock-')), 'b.db'));
    store.saveChannelLock('g', 'c', { allow: 0n, deny: 2048n });
    expect(store.channelLock('c')).toEqual({ allow: 0n, deny: 2048n });
    store.removeChannelLock('c');
    expect(store.channelLock('c')).toBeNull();
    store.close();
  });
});
