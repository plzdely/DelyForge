import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MODULE_CONFIGS, type ModuleConfigs } from '@delyforge/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBlocked } from '../src/modules/applications.js';
import { desiredCommands } from '../src/modules/commands.js';
import { desiredPanels } from '../src/modules/panels.js';
import { withPriority } from '../src/modules/tickets.js';
import { emojiSource } from '../src/modules/utility.js';
import { BotStore } from '../src/store.js';

const C = '123456789012345678';
const base = DEFAULT_MODULE_CONFIGS;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function store() {
  const dir = mkdtempSync(join(tmpdir(), 'df-v05-'));
  dirs.push(dir);
  return BotStore.open(dir, '1');
}

describe('economy store', () => {
  it('never lets a wallet go below zero and moves coins atomically', () => {
    const s = store();
    expect(s.account('g', 'a', 100).wallet).toBe(100);
    expect(s.addCoins('g', 'a', -150, 100)).toBe(false);
    expect(s.transferCoins('g', 'a', 'b', 60, 100)).toBe(true);
    expect(s.account('g', 'a', 100).wallet).toBe(40);
    expect(s.account('g', 'b', 100).wallet).toBe(160);
    expect(s.transferCoins('g', 'a', 'b', 41, 100)).toBe(false);
    expect(s.transferCoins('g', 'a', 'a', 1, 100)).toBe(false);
    expect(s.moveToBank('g', 'b', 100, true, 100)).toBe(true);
    expect(s.moveToBank('g', 'b', 101, false, 100)).toBe(false);
    expect(s.account('g', 'b', 100)).toMatchObject({ wallet: 60, bank: 100 });
    expect(s.richest('g')[0]).toEqual({ userId: 'b', total: 160 });
    s.addItem('g', 'b', 'vip');
    s.addItem('g', 'b', 'vip');
    expect(s.items('g', 'b')).toEqual([{ itemId: 'vip', count: 2 }]);
    s.resetEconomy('g', 'b');
    expect(s.items('g', 'b')).toEqual([]);
    s.close();
  });
});

describe('counting, modmail, applications and tickets store', () => {
  it('keeps the count, the record and who counted', () => {
    const s = store();
    s.setCounting('g', 1, 'a');
    s.setCounting('g', 2, 'b');
    s.setCounting('g', 3, 'a');
    s.setCounting('g', 0, null);
    expect(s.counting('g')).toEqual({ count: 0, lastUserId: null, record: 3 });
    expect(s.topCounters('g')).toEqual([{ userId: 'a', n: 2 }, { userId: 'b', n: 1 }]);
    s.close();
  });

  it('modmail: one open conversation, closes once, blocks', () => {
    const s = store();
    s.addModmail('g', 'u', 't1', 0);
    expect(s.openModmail('g', 'u')).toBe('t1');
    expect(s.modmailByThread('t1')).toEqual({ guildId: 'g', userId: 'u', open: true });
    expect(s.closeModmail('t1')).toBe(true);
    expect(s.closeModmail('t1')).toBe(false);
    expect(s.openModmail('g', 'u')).toBeNull();
    s.setModmailBlocked('g', 'u', true);
    expect(s.modmailBlocked('g', 'u')).toBe(true);
    s.setModmailBlocked('g', 'u', false);
    expect(s.modmailBlocked('g', 'u')).toBe(false);
    s.close();
  });

  it('applications: decided once, cooldown and pending checks', () => {
    const s = store();
    const id = s.addApplication({ guildId: 'g', formId: 'staff', userId: 'u', answers: [{ q: 'Why?', a: 'Because' }] }, 0);
    expect(applyBlocked(s.lastApplication('g', 'staff', 'u'), 24, 0)).toMatch(/already/);
    expect(s.decideApplication(id, 'denied', 'mod', 1000)).toBe(true);
    expect(s.decideApplication(id, 'accepted', 'mod', 2000)).toBe(false);
    expect(applyBlocked(s.lastApplication('g', 'staff', 'u'), 24, 2000)).toMatch(/again/);
    expect(applyBlocked(s.lastApplication('g', 'staff', 'u'), 24, 1000 + 24 * 3_600_000)).toBeNull();
    expect(applyBlocked(s.lastApplication('g', 'staff', 'u'), 0, 2000)).toBeNull();
    expect(s.application(id)?.answers).toEqual([{ q: 'Why?', a: 'Because' }]);
    s.close();
  });

  it('tickets: claim, unclaim and transfer; temp roles and AFK', () => {
    const s = store();
    s.addTicket('g', 'ch', 'owner');
    expect(s.setTicketClaim('ch', 'mod1')).toBe(true);
    expect(s.ticketByChannel('ch')?.claimedBy).toBe('mod1');
    s.setTicketClaim('ch', null);
    expect(s.ticketByChannel('ch')?.claimedBy).toBeNull();
    expect(s.ticketStats('g', 0).open).toBe(1);
    s.addTempRole('g', 'u', 'r', 500);
    expect(s.takeDueTempRoles(100)).toEqual([]);
    expect(s.takeDueTempRoles(600)).toEqual([{ guildId: 'g', userId: 'u', roleId: 'r' }]);
    expect(s.takeDueTempRoles(600)).toEqual([]);
    s.setAfk('g', 'u', 'lunch', 5);
    expect(s.afk('g', 'u')).toEqual({ reason: 'lunch', since: 5 });
    expect(s.clearAfk('g', 'u')).toBe(true);
    expect(s.clearAfk('g', 'u')).toBe(false);
    s.close();
  });
});

describe('helpers and registration', () => {
  it('puts a priority emoji in front of a ticket name, replacing an old one', () => {
    expect(withPriority('ticket-3-dely', 'high')).toBe('🔴-ticket-3-dely');
    expect(withPriority('🔴-ticket-3-dely', 'low')).toBe('🟢-ticket-3-dely');
    expect(withPriority('🟡-ticket-3-dely', 'none')).toBe('ticket-3-dely');
  });

  it('reads pasted emojis and image links', () => {
    expect(emojiSource('<:wave:123456789012345678>')).toEqual({ url: 'https://cdn.discordapp.com/emojis/123456789012345678.png', name: 'wave' });
    expect(emojiSource('<a:dance:123456789012345678>')?.url).toMatch(/\.gif$/);
    expect(emojiSource('https://cdn.discordapp.com/attachments/1/2/a.png')).toEqual({ url: 'https://cdn.discordapp.com/attachments/1/2/a.png', name: null });
    // Only Discord's CDN: never other sites, local addresses or tricks with ports and user names.
    expect(emojiSource('https://example.com/a.png')).toBeNull();
    expect(emojiSource('https://192.168.1.1/a.png')).toBeNull();
    expect(emojiSource('https://cdn.discordapp.com@evil.com/a.png')).toBeNull();
    expect(emojiSource('https://cdn.discordapp.com:8443/a.png')).toBeNull();
    expect(emojiSource('http://cdn.discordapp.com/a.png')).toBeNull();
    expect(emojiSource('hello')).toBeNull();
  });

  it('registers the new modules’ commands only when they are on', () => {
    const on = (patch: Partial<ModuleConfigs>) => desiredCommands({ ...base, ...patch }).map((c) => c.name);
    expect(on({ modmail: { ...base.modmail, enabled: true } })).toEqual(['modmail']);
    const eco = on({ economy: { ...base.economy, enabled: true } });
    expect(eco).toEqual(expect.arrayContaining(['balance', 'daily', 'work', 'pay', 'rob', 'coinflip', 'slots', 'eco', 'rich']));
    expect(eco).not.toContain('buy'); // no shop items yet
    expect(on({ economy: { ...base.economy, enabled: true, rob: { ...base.economy.rob, enabled: false }, gambling: { ...base.economy.gambling, enabled: false } } })).not.toEqual(expect.arrayContaining(['rob']));
    expect(on({ games: { ...base.games, enabled: true } })).toEqual(['trivia', 'rps', '8ball', 'tictactoe', 'wouldyourather', 'truth', 'dare']);
    expect(on({ games: { ...base.games, enabled: true, counting: { ...base.games.counting, channelId: C } } })).toContain('count');
  });

  it('posts an application panel only with a panel and a review channel', () => {
    const form = { id: 'staff', name: 'Staff', panel: { channelId: C, title: 'Apply', description: '', buttonLabel: 'Apply', color: '#7c5cff' }, reviewChannelId: null, reviewerRoleIds: [], questions: [{ label: 'Why?', style: 'short' as const, required: true }], acceptRoleId: null, removeRoleId: null, acceptMessage: '', denyMessage: '', cooldownHours: 0, thread: false, open: true, minAccountAgeDays: 0, pingReviewers: false };
    const panels = (f: typeof form) => desiredPanels({ ...base, applications: { enabled: true, forms: [f] } }, 0).map((p) => p.key);
    expect(panels(form)).toEqual([]);
    expect(panels({ ...form, reviewChannelId: C } as never)).toEqual(['app:staff']);
  });
});
