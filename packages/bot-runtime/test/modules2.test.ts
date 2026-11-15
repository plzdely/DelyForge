import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MODULE_CONFIGS, type ModuleConfigs } from '@delyforge/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { desiredCommands } from '../src/modules/commands.js';
import { parseDuration, pickWinners } from '../src/modules/community.js';
import { rewardRolesFor } from '../src/modules/leveling.js';
import { CID, desiredPanels } from '../src/modules/panels.js';
import { formatTranscript, ticketChannelName } from '../src/modules/tickets.js';
import { BotStore } from '../src/store.js';

const C = '123456789012345678';
const R1 = '223456789012345678';
const R2 = '323456789012345678';
const base = DEFAULT_MODULE_CONFIGS;
const with_ = (patch: Partial<ModuleConfigs>): ModuleConfigs => ({ ...base, ...patch });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function store() {
  const dir = mkdtempSync(join(tmpdir(), 'df-store2-'));
  dirs.push(dir);
  return BotStore.open(dir, '1');
}

describe('leveling', () => {
  const rewards = [
    { level: 5, roleId: R1 },
    { level: 10, roleId: R2 },
  ];
  it('stacks or keeps only the highest reward', () => {
    expect(rewardRolesFor(rewards, 12, true)).toEqual({ keep: [R1, R2], drop: [] });
    expect(rewardRolesFor(rewards, 12, false)).toEqual({ keep: [R2], drop: [R1] });
    expect(rewardRolesFor(rewards, 3, true)).toEqual({ keep: [], drop: [R1, R2] });
  });

  it('respects the XP cooldown', () => {
    const s = store();
    expect(s.addXp('g', 'u', 20, 1000, 60_000)).toEqual({ before: 0, after: 20 });
    expect(s.addXp('g', 'u', 20, 30_000, 60_000)).toBeNull();
    expect(s.addXp('g', 'u', 20, 61_000, 60_000)).toEqual({ before: 20, after: 40 });
    s.addXp('g', 'top', 500, 0, 0);
    expect(s.xpOf('g', 'u')).toEqual({ xp: 40, rank: 2 });
    expect(s.leaderboard('g').map((r) => r.userId)).toEqual(['top', 'u']);
    s.close();
  });
});

describe('tickets', () => {
  it('makes safe channel names', () => {
    expect(ticketChannelName('Dely 🎮!', 7)).toBe('ticket-7-dely');
    expect(ticketChannelName('🎮🎮', 1)).toBe('ticket-1-member');
  });

  it('formats transcripts oldest first, with attachments', () => {
    const text = formatTranscript('ticket-1-dely', [
      { at: new Date('2026-11-15T10:00:00Z'), author: 'dely', content: 'Help!', attachments: [] },
      { at: new Date('2026-11-15T10:01:00Z'), author: 'mod', content: 'On it', attachments: ['https://cdn/x.png'] },
    ]);
    expect(text).toContain('2 message(s)');
    expect(text).toMatch(/\[2026-11-15 10:00:00\] dely: Help!\n\[2026-11-15 10:01:00\] mod: On it \[files: https:\/\/cdn\/x.png\]/);
  });

  it('closes a ticket only once and limits open tickets per member', () => {
    const s = store();
    s.addTicket('g', 'c1', 'u');
    expect(s.openTickets('g', 'u')).toEqual(['c1']);
    expect(s.nextTicketNumber('g')).toBe(2);
    expect(s.closeTicket('c1')).toBe(true);
    expect(s.closeTicket('c1')).toBe(false);
    expect(s.openTickets('g', 'u')).toEqual([]);
    s.close();
  });
});

describe('giveaways', () => {
  it('parses durations', () => {
    expect(parseDuration('30m')).toBe(30 * 60_000);
    expect(parseDuration('1h30m')).toBe(90 * 60_000);
    expect(parseDuration('2d')).toBe(2 * 86_400_000);
    expect(parseDuration('0m')).toBeNull();
    expect(parseDuration('31d')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('1h and some')).toBeNull();
  });

  it('picks unique winners and skips excluded ones', () => {
    const entries = ['a', 'b', 'c', 'd'];
    for (let n = 0; n < 50; n++) {
      const w = pickWinners(entries, 3);
      expect(new Set(w).size).toBe(3);
    }
    expect(pickWinners(entries, 10)).toHaveLength(4);
    expect(pickWinners(['a', 'b'], 2, ['a'])).toEqual(['b']);
    expect(pickWinners([], 1)).toEqual([]);
  });

  it('toggles entries and ends only once', () => {
    const s = store();
    const id = s.addGiveaway({ guildId: 'g', channelId: 'c', prize: 'Nitro', winners: 1, hostId: 'h', endsAt: 1000 });
    expect(s.toggleEntry(id, 'u')).toEqual({ entered: true, count: 1 });
    expect(s.toggleEntry(id, 'u')).toEqual({ entered: false, count: 0 });
    s.toggleEntry(id, 'u');
    expect(s.dueGiveaways(2000).map((g) => g.id)).toEqual([id]);
    expect(s.endGiveaway(id, ['u'])).toBe(true);
    expect(s.endGiveaway(id, ['u'])).toBe(false);
    expect(s.giveaway(id)).toMatchObject({ ended: true, winnerIds: ['u'] });
    expect(s.dueGiveaways(2000)).toEqual([]);
    s.close();
  });
});

describe('suggestions', () => {
  it('counts votes, switches and takes them back', () => {
    const s = store();
    const id = s.addSuggestion('g', 'c', 'u', 'More emojis');
    expect(s.vote(id, 'a', 1)).toEqual({ up: 1, down: 0 });
    expect(s.vote(id, 'b', -1)).toEqual({ up: 1, down: 1 });
    expect(s.vote(id, 'a', -1)).toEqual({ up: 0, down: 2 });
    expect(s.vote(id, 'a', -1)).toEqual({ up: 0, down: 1 });
    s.close();
  });
});

describe('panels and commands', () => {
  it('posts no panels until a module is enabled with a channel', () => {
    expect(desiredPanels(base)).toEqual([]);
    expect(desiredPanels(with_({ tickets: { ...base.tickets, enabled: true } }))).toEqual([]);
  });

  it('builds ticket, verification and role panels with routable button IDs', () => {
    const panels = desiredPanels(
      with_({
        tickets: { ...base.tickets, enabled: true, panel: { ...base.tickets.panel, channelId: C } },
        verification: { ...base.verification, enabled: true, roleId: R1, panel: { ...base.verification.panel, channelId: C } },
        reactionRoles: {
          enabled: true,
          panels: [{ id: 'games', channelId: C, title: 'Games', description: '', color: '#7c5cff', mode: 'buttons', multiple: true, roles: [{ roleId: R2, label: 'Minecraft', emoji: '⛏️' }] }],
        },
      }),
    );
    expect(panels.map((p) => p.key)).toEqual(['tickets', 'verification', 'rr:games']);
    const json = JSON.stringify(panels.map((p) => p.payload));
    expect(json).toContain(CID.ticketOpen);
    expect(json).toContain(CID.verify);
    expect(json).toContain(CID.roleButton('games', R2));
    // Changing the text changes the hash, so the bot edits the posted message.
    const changed = desiredPanels(with_({ tickets: { ...base.tickets, enabled: true, panel: { ...base.tickets.panel, channelId: C, title: 'Support' } } }));
    expect(changed[0]!.hash).not.toBe(panels[0]!.hash);
  });

  it('registers the new commands only for enabled modules', () => {
    const names = desiredCommands(
      with_({
        leveling: { ...base.leveling, enabled: true },
        tickets: { ...base.tickets, enabled: true },
        suggestions: { ...base.suggestions, enabled: true },
        giveaways: { ...base.giveaways, enabled: true },
      }),
    ).map((c) => c.name);
    expect(names).toEqual(['rank', 'leaderboard', 'ticket', 'suggest', 'giveaway']);
  });
});
