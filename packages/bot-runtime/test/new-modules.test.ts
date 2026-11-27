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
    const counts = { members: 120, humans: 110, bots: 10, boosts: 2, channels: 30, roles: 8, textChannels: 20, voiceChannels: 5, emojis: 40, boostTier: 1 };
    expect(statName('Members: {members} · Bots: {bots}', counts)).toBe('Members: 120 · Bots: 10');
    expect(statName('💬 {textChannels} · 🔊 {voiceChannels} · Tier {boostTier}', counts)).toBe('💬 20 · 🔊 5 · Tier 1');
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
      { channelId: '1', text: 'daily', days: [], time: '09:30', roleId: null, embed: false, color: '#7c5cff', deletePrevious: false, date: '' },
      { channelId: '1', text: 'mondays', days: [1], time: '09:30', roleId: null, embed: false, color: '#7c5cff', deletePrevious: false, date: '' },
    ];
    expect(dueMessages(msgs, { day: 3, time: '09:30' })).toEqual([0]);
    expect(dueMessages(msgs, { day: 1, time: '09:30' })).toEqual([0, 1]);
    const once = [{ ...msgs[0]!, date: '2026-12-24' }];
    expect(dueMessages(once, { day: 4, time: '09:30', date: '2026-12-24' })).toEqual([0]);
    expect(dueMessages(once, { day: 4, time: '09:30', date: '2026-12-25' })).toEqual([]);
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

describe('problem alerts', () => {
  it('reports permissions the bot loses, but not ones a newly enabled module needs', async () => {
    const { checkLostPermissions } = await import('../src/modules/trust.js');
    const ALL = (1n << 41n) - 1n & ~(1n << 3n); // everything except Administrator
    const SEND = 1n << 11n;
    let modules = resolveGuildModules({ welcome: { ...DEFAULT_MODULE_CONFIGS.welcome, enabled: true } });
    const ctx = { config: () => modules } as never;
    const guild = { id: 'g1', name: 'Aurora', members: { me: { permissions: { bitfield: ALL } } } };
    const reports: string[] = [];
    const check = (baseline = false) => checkLostPermissions(ctx, guild as never, (m) => reports.push(m), baseline);
    check(true);
    guild.members.me.permissions.bitfield = ALL & ~SEND;
    check();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatch(/Aurora.*Send Messages/);
    // Enabling a module that needs Manage Roles (which the bot lacks) is a baseline, not a loss.
    guild.members.me.permissions.bitfield = ALL & ~SEND & ~(1n << 28n);
    modules = resolveGuildModules({ welcome: { ...DEFAULT_MODULE_CONFIGS.welcome, enabled: true }, verification: { ...DEFAULT_MODULE_CONFIGS.verification, enabled: true } });
    check(true);
    check();
    expect(reports).toHaveLength(1);
  });
});

describe('verification log', () => {
  it('shows who, account age (flagging new accounts), join time and the result', async () => {
    const { verifyLogEmbed } = await import('../src/modules/roles.js');
    const now = Date.UTC(2026, 10, 25);
    const e = verifyLogEmbed({ id: '42', tag: 'newbie', createdTimestamp: now - 2 * 86_400_000, joinedTimestamp: now - 60_000, avatarUrl: 'https://cdn/x.png' }, 'tooNew', now);
    expect(e.title).toMatch(/too new/);
    expect(e.fields[0]!.value).toContain('<@42>');
    expect(e.fields[1]!.value).toMatch(/2 days old\) ⚠️ new account/);
    expect(verifyLogEmbed({ id: '1', tag: 'old', createdTimestamp: now - 400 * 86_400_000, joinedTimestamp: null, avatarUrl: '' }, 'verified', now).fields[1]!.value).not.toMatch(/new account/);
  });
});

describe('temporary voice ownership', () => {
  it('remembers which channel a member owns, so the hub sends them back to it', () => {
    const store = new BotStore(join(mkdtempSync(join(tmpdir(), 'df-tv-')), 'b.db'));
    expect(store.tempChannelOf('g', 'u1')).toBeNull();
    store.addTempChannel('g', 'c1', 'u1');
    expect(store.tempChannelOf('g', 'u1')).toBe('c1');
    store.removeTempChannel('c1');
    expect(store.tempChannelOf('g', 'u1')).toBeNull();
    store.close();
  });
});

describe('kick members who never verify', () => {
  it('only removes old-enough joins with no roles (besides “unverified”), never bots or staff', async () => {
    const { pickUnverified } = await import('../src/modules/roles.js');
    const now = Date.UTC(2026, 10, 25, 12);
    const H = 3_600_000;
    const members = [
      { id: 'late', bot: false, joinedAt: now - 30 * H, roleIds: ['G'] },
      { id: 'lateUnverifiedRole', bot: false, joinedAt: now - 30 * H, roleIds: ['G', 'UNV'] },
      { id: 'fresh', bot: false, joinedAt: now - 2 * H, roleIds: ['G'] },
      { id: 'staff', bot: false, joinedAt: now - 300 * H, roleIds: ['G', 'MOD'] },
      { id: 'verified', bot: false, joinedAt: now - 30 * H, roleIds: ['G', 'VER'] },
      { id: 'robot', bot: true, joinedAt: now - 30 * H, roleIds: ['G'] },
    ];
    expect(pickUnverified(members, { roleId: 'VER', removeRoleId: 'UNV', kickAfterHours: 24 }, 'G', now)).toEqual(['late', 'lateUnverifiedRole']);
  });
});

describe('warnings that expire', () => {
  it('only counts warnings newer than the cut-off', () => {
    const store = new BotStore(join(mkdtempSync(join(tmpdir(), 'df-warn-')), 'b.db'));
    store.addWarning('g', 'u', 'm', 'old');
    expect(store.warningCount('g', 'u')).toBe(1);
    expect(store.addWarning('g', 'u', 'm', 'new', Date.now() + 60_000)).toBe(0); // cut-off in the future: nothing counts
    expect(store.warningCount('g', 'u', Date.now() - 60_000)).toBe(2);
    expect(store.warnings('g', 'u', Date.now() + 60_000)).toEqual([]);
    store.close();
  });
});

describe('v0.4 leveling, giveaways and starboard', () => {
  it('uses the biggest XP boost a member has', async () => {
    const { xpMultiplier } = await import('../src/modules/leveling.js');
    const boosts = [{ roleId: 'a', multiplier: 1.5 }, { roleId: 'b', multiplier: 2 }];
    expect(xpMultiplier(boosts, ['a', 'b'])).toBe(2);
    expect(xpMultiplier(boosts, ['x'])).toBe(1);
  });

  it('gives members with bonus entries a better chance, without ever picking anyone twice', async () => {
    const { weightedOrder } = await import('../src/modules/community.js');
    let first = 0;
    for (let n = 0; n < 2000; n++) if (weightedOrder([{ userId: 'bonus', weight: 5 }, { userId: 'normal', weight: 1 }])[0] === 'bonus') first++;
    expect(first / 2000).toBeGreaterThan(0.75); // 5 / 6 ≈ 0.83
    expect(new Set(weightedOrder([{ userId: 'a', weight: 3 }, { userId: 'b', weight: 1 }, { userId: 'c', weight: 2 }])).size).toBe(3);
  });

  it('sets XP exactly (never below zero) and ranks starboard authors', () => {
    const store = new BotStore(join(mkdtempSync(join(tmpdir(), 'df-v04-')), 'b.db'));
    expect(store.setXp('g', 'u', 500)).toEqual({ before: 0, after: 500 });
    expect(store.setXp('g', 'u', -20).after).toBe(0);
    store.setStarPost('g', 'm1', 's1', 'alice', 5);
    store.setStarPost('g', 'm2', 's2', 'alice', 3);
    store.setStarPost('g', 'm3', 's3', 'bob', 6);
    expect(store.starLeaderboard('g')).toEqual([{ userId: 'alice', stars: 8, posts: 2 }, { userId: 'bob', stars: 6, posts: 1 }]);
    store.close();
  });
});

describe('v0.4 tickets, invites and voice', () => {
  it('takes invite rewards back when the count drops', async () => {
    const { inviteRewardRoles } = await import('../src/modules/invites.js');
    const rewards = [{ invites: 5, roleId: 'r5' }, { invites: 10, roleId: 'r10' }];
    expect(inviteRewardRoles(rewards, 10)).toEqual({ keep: ['r5', 'r10'], drop: [] });
    expect(inviteRewardRoles(rewards, 7)).toEqual({ keep: ['r5'], drop: ['r10'] });
    expect(inviteRewardRoles(rewards, 0)).toEqual({ keep: [], drop: ['r5', 'r10'] });
  });

  it('knows when a ticket is idle, lets only one staff member claim it, and tracks voice owners', async () => {
    const { ticketIsIdle } = await import('../src/modules/tickets.js');
    const H = 3_600_000;
    expect(ticketIsIdle(0, 24, 25 * H)).toBe(true);
    expect(ticketIsIdle(0, 24, 23 * H)).toBe(false);
    expect(ticketIsIdle(0, 0, 999 * H)).toBe(false); // 0 = never
    const store = new BotStore(join(mkdtempSync(join(tmpdir(), 'df-tk-')), 'b.db'));
    store.addTicket('g', 'c1', 'u', 'My order is missing');
    expect(store.claimTicket('c1', 'staffA')).toBe(true);
    expect(store.claimTicket('c1', 'staffB')).toBe(false);
    expect(store.ticketByChannel('c1')).toMatchObject({ reason: 'My order is missing', claimedBy: 'staffA' });
    expect(store.openTicketsInGuild('g')).toHaveLength(1);
    store.addTempChannel('g', 'v1', 'owner');
    store.setTempChannelOwner('v1', 'newOwner');
    expect(store.tempChannelOwner('v1')).toBe('newOwner');
    store.close();
  });
});

describe('v0.4 utility and feeds', () => {
  it('filters feed posts by keywords and skips Shorts', async () => {
    const { wantedItem } = await import('../src/modules/feeds.js');
    const feed = { keywords: 'update, patch', skipShorts: true };
    expect(wantedItem({ title: 'Big PATCH notes', link: 'https://www.youtube.com/watch?v=1' }, feed)).toBe(true);
    expect(wantedItem({ title: 'Vlog', link: 'https://www.youtube.com/watch?v=2' }, feed)).toBe(false);
    expect(wantedItem({ title: 'Update teaser', link: 'https://www.youtube.com/shorts/3' }, feed)).toBe(false);
    expect(wantedItem({ title: 'Anything', link: 'https://blog/x' }, { keywords: '', skipShorts: false })).toBe(true);
  });

  it('delivers each due reminder once', () => {
    const store = new BotStore(join(mkdtempSync(join(tmpdir(), 'df-rem-')), 'b.db'));
    store.addReminder({ guildId: 'g', channelId: 'c', userId: 'u', text: 'stretch', dueAt: 1000 });
    store.addReminder({ guildId: 'g', channelId: 'c', userId: 'u', text: 'later', dueAt: 9_999_999_999_999 });
    expect(store.pendingReminders('g', 'u')).toBe(2);
    expect(store.takeDueReminders(2000).map((r) => r.text)).toEqual(['stretch']);
    expect(store.takeDueReminders(2000)).toEqual([]);
    store.saveScheduledPost('k', 'c', 'm1');
    store.saveScheduledPost('k', 'c', 'm2');
    expect(store.lastScheduledPost('k')).toEqual({ channelId: 'c', messageId: 'm2' });
    store.close();
  });
});

describe('0.4.1 small additions', () => {
  it('removes one warning, and lists running giveaways', () => {
    const store = new BotStore(join(mkdtempSync(join(tmpdir(), 'df-041-')), 'b.db'));
    store.addWarning('g', 'u', 'm', 'first');
    store.addWarning('g', 'u', 'm', 'second');
    const [newest] = store.warnings('g', 'u');
    expect(store.removeWarning('g', 'someoneElse', newest!.id)).toBe(false);
    expect(store.removeWarning('g', 'u', newest!.id)).toBe(true);
    expect(store.warnings('g', 'u').map((w) => w.reason)).toEqual(['first']);
    const id = store.addGiveaway({ guildId: 'g', channelId: 'c', prize: 'Nitro', winners: 1, hostId: 'h', endsAt: Date.now() + 60_000, requiredRoleId: null });
    store.toggleEntry(id, 'a');
    expect(store.runningGiveaways('g')).toMatchObject([{ id, prize: 'Nitro', entries: 1 }]);
    store.endGiveaway(id, []);
    expect(store.runningGiveaways('g')).toEqual([]);
    store.close();
  });
});
