import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MODULE_CONFIGS, type ModuleConfigs } from '@delyforge/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { periodStart } from '../src/modules/activity.js';
import { desiredCommands } from '../src/modules/commands.js';
import { htmlTranscript } from '../src/modules/tickets.js';
import { BotStore } from '../src/store.js';

const C = '123456789012345678';
const base = DEFAULT_MODULE_CONFIGS;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function store() {
  const dir = mkdtempSync(join(tmpdir(), 'df-v05b-'));
  dirs.push(dir);
  return BotStore.open(dir, '1');
}

describe('round 2 store', () => {
  it('confessions: numbered only when posted, decided once', () => {
    const s = store();
    expect(s.addConfession('g', 'u', 'one', null, 'posted', 1).number).toBe(1);
    const pending = s.addConfession('g', 'u', 'two', null, 'pending', 2);
    expect(pending.number).toBeNull();
    expect(s.decideConfession(pending.id, true)).toBe(2);
    expect(s.decideConfession(pending.id, true)).toBe(false);
    expect(s.lastConfessionAt('g', 'u')).toBe(2);
    s.setConfessionBanned('g', 'u', true);
    expect(s.confessionBanned('g', 'u')).toBe(true);
    s.close();
  });

  it('highlights: words, everyone’s words and ignored channels', () => {
    const s = store();
    expect(s.addHighlight('g', 'a', 'dely')).toBe(true);
    expect(s.addHighlight('g', 'a', 'dely')).toBe(false);
    s.addHighlight('g', 'b', 'dely');
    expect(s.allHighlights('g').get('dely')).toEqual(['a', 'b']);
    expect(s.toggleHighlightIgnore('g', 'a', 'c1')).toBe(true);
    expect(s.highlightIgnored('g', 'a', 'c1')).toBe(true);
    expect(s.toggleHighlightIgnore('g', 'a', 'c1')).toBe(false);
    expect(s.removeHighlight('g', 'a', null)).toBe(1);
    s.close();
  });

  it('reputation: one per cooldown per giver; snapshots; channel post limits', () => {
    const s = store();
    expect(s.giveRep('g', 'a', 'b', 1000, 0)).toBe(1);
    expect(s.giveRep('g', 'a', 'c', 1000, 500)).toBeNull();
    expect(s.giveRep('g', 'a', 'c', 1000, 1500)).toBe(1);
    expect(s.repReadyAt('g', 'a', 1000)).toBe(2500);
    expect(s.topReps('g')).toHaveLength(2);
    s.saveSnapshot('g', 'u', ['r1', 'r2'], 'Nick', 10);
    expect(s.takeSnapshot('g', 'u')).toEqual({ roles: ['r1', 'r2'], nick: 'Nick', leftAt: 10 });
    expect(s.takeSnapshot('g', 'u')).toBeNull();
    expect(s.tooSoonInChannel('c', 'u', 1000, 0)).toBe(false);
    expect(s.tooSoonInChannel('c', 'u', 1000, 500)).toBe(true);
    expect(s.tooSoonInChannel('c', 'u', 1000, 1200)).toBe(false);
    s.close();
  });

  it('activity: per day, per period, top lists', () => {
    const s = store();
    s.addActivity('g', 'a', '2026-11-20', 5, 0);
    s.addActivity('g', 'a', '2026-11-27', 3, 10);
    s.addActivity('g', 'b', '2026-11-27', 7, 0);
    expect(s.activityOf('g', 'a', '2026-11-27')).toEqual({ messages: 3, voice: 10 });
    expect(s.activityOf('g', 'a', '')).toEqual({ messages: 8, voice: 10 });
    expect(s.topActivity('g', '2026-11-27', 'messages')).toEqual([{ userId: 'b', n: 7 }, { userId: 'a', n: 3 }]);
    expect(s.topActivity('g', '', 'voice')).toEqual([{ userId: 'a', n: 10 }]);
    expect(s.serverActivity('g', '2026-11-27')).toEqual([{ day: '2026-11-27', messages: 10, voice: 10, members: 2 }]);
    s.close();
  });

  it('tickets blacklist, reminders list/cancel and bank interest', () => {
    const s = store();
    s.setTicketBlacklisted('g', 'u', true);
    expect(s.ticketBlacklisted('g', 'u')).toBe(true);
    const id = s.addReminder({ guildId: 'g', channelId: 'c', userId: 'u', text: 'hi', dueAt: 5 });
    expect(s.remindersOf('g', 'u')).toEqual([{ id, text: 'hi', dueAt: 5 }]);
    expect(s.cancelReminder(id, 'other')).toBe(false);
    expect(s.cancelReminder(id, 'u')).toBe(true);
    s.account('g', 'u', 0);
    s.addCoins('g', 'u', 1000, 0);
    s.moveToBank('g', 'u', 1000, true, 0);
    s.applyInterest('g', 2);
    expect(s.account('g', 'u', 0).bank).toBe(1020);
    s.close();
  });
});

describe('round 2 helpers and registration', () => {
  it('HTML transcripts escape everything', () => {
    const html = htmlTranscript('ticket-1', [{ at: new Date(0), author: '<b>x</b>', bot: false, content: '<script>alert(1)</script>', attachments: ['https://cdn/x"y'] }]);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain("default-src 'none'");
  });

  it('periods for activity', () => {
    const now = Date.parse('2026-11-27T12:00:00Z');
    expect(periodStart('1', now)).toBe('2026-11-27');
    expect(periodStart('7', now)).toBe('2026-11-21');
    expect(periodStart('all', now)).toBe('');
  });

  it('registers commands for the round 2 modules, the report menu and modmail snippets', () => {
    const names = (patch: Partial<ModuleConfigs>) => desiredCommands({ ...base, ...patch }).map((c) => c.name);
    expect(names({ moderation: { ...base.moderation, enabled: true, reportChannelId: C } })).toEqual(expect.arrayContaining(['report', 'Report message', 'massban', 'move', 'disconnect']));
    expect(names({ moderation: { ...base.moderation, enabled: true } })).not.toContain('report');
    expect(names({ confessions: { ...base.confessions, enabled: true } })).toEqual([]);
    expect(names({ confessions: { ...base.confessions, enabled: true, channelId: C } })).toEqual(['confess', 'confessions']);
    expect(names({ highlights: { ...base.highlights, enabled: true } })).toEqual(['highlight']);
    expect(names({ activity: { ...base.activity, enabled: true } })).toEqual(['activity', 'topchatters', 'topvoice', 'serveractivity']);
    expect(names({ reputation: { ...base.reputation, enabled: true } })).toEqual(['rep']);
    const mm = desiredCommands({ ...base, modmail: { ...base.modmail, enabled: true, snippets: [{ name: 'hi', text: 'Hello!' }] } })[0] as { options: { name: string }[] };
    expect(mm.options.map((o) => o.name)).toContain('snippet');
  });
});
