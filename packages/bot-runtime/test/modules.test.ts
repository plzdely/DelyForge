import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MODULE_CONFIGS } from '@delyforge/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { commandHash, desiredCommands } from '../src/modules/commands.js';
import { hierarchyProblem } from '../src/modules/moderation.js';
import { parsePollOptions } from '../src/modules/utility.js';
import { BotStore, planCommandSync } from '../src/store.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'df-store-'));
  dirs.push(dir);
  return BotStore.open(dir, '123456789012345678');
}

describe('BotStore', () => {
  it('counts, lists and clears warnings per server and member', () => {
    const s = store();
    expect(s.addWarning('g1', 'u1', 'mod', 'spam')).toBe(1);
    expect(s.addWarning('g1', 'u1', 'mod', 'rude')).toBe(2);
    s.addWarning('g2', 'u1', 'mod', 'other server');
    expect(s.warnings('g1', 'u1').map((w) => w.reason)).toEqual(['rude', 'spam']);
    expect(s.clearWarnings('g1', 'u1')).toBe(2);
    expect(s.warningCount('g1', 'u1')).toBe(0);
    expect(s.warningCount('g2', 'u1')).toBe(1);
    s.close();
  });

  it('remembers which commands DelyForge created', () => {
    const s = store();
    s.saveManagedCommand({ guildId: 'g1', name: 'warn', commandId: 'c1', hash: 'h1' });
    s.saveManagedCommand({ guildId: 'g1', name: 'warn', commandId: 'c2', hash: 'h2' });
    expect(s.managedCommands('g1')).toEqual([{ guildId: 'g1', name: 'warn', commandId: 'c2', hash: 'h2' }]);
    s.removeManagedCommand('g1', 'warn');
    expect(s.managedCommands('g1')).toEqual([]);
    s.close();
  });
});

describe('planCommandSync', () => {
  it('creates missing, updates changed and removes only its own unwanted commands', () => {
    const plan = planCommandSync(
      [
        { name: 'warn', hash: 'same' },
        { name: 'kick', hash: 'new' },
        { name: 'poll', hash: 'x' },
      ],
      [
        { guildId: 'g', name: 'warn', commandId: '1', hash: 'same' },
        { guildId: 'g', name: 'kick', commandId: '2', hash: 'old' },
        { guildId: 'g', name: 'avatar', commandId: '3', hash: 'y' },
      ],
    );
    expect(plan.create).toEqual(['poll']);
    expect(plan.update.map((m) => m.name)).toEqual(['kick']);
    expect(plan.remove.map((m) => m.name)).toEqual(['avatar']);
  });
});

describe('desiredCommands', () => {
  const base = DEFAULT_MODULE_CONFIGS;

  it('registers nothing when no module is enabled', () => {
    expect(desiredCommands(base)).toEqual([]);
  });

  it('adds staff-only moderation commands and the enabled utility commands', () => {
    const cmds = desiredCommands({
      ...base,
      moderation: { ...base.moderation, enabled: true },
      utility: { enabled: true, commands: { serverinfo: true, userinfo: false, avatar: true, poll: false } },
    });
    const names = cmds.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['warn', 'ban', 'purge', 'serverinfo', 'avatar']));
    expect(names).not.toContain('userinfo');
    expect(cmds.find((c) => c.name === 'ban')?.default_member_permissions).toBe(String(1n << 2n));
  });

  it('hashes command definitions stably', () => {
    const [a] = desiredCommands({ ...base, utility: { ...base.utility, enabled: true } });
    expect(commandHash(a!)).toBe(commandHash(JSON.parse(JSON.stringify(a))));
  });
});

describe('parsePollOptions', () => {
  it('accepts 2–10 unique answers', () => {
    expect(parsePollOptions('Yes | No | Maybe')).toEqual(['Yes', 'No', 'Maybe']);
    expect(parsePollOptions('Yes|yes|Yes')).toBeNull();
    expect(parsePollOptions('Only one')).toBeNull();
    expect(parsePollOptions(Array.from({ length: 11 }, (_, i) => `o${i}`).join('|'))).toBeNull();
  });
});

describe('hierarchyProblem (who may punish whom)', () => {
  const m = (id: string, position: number) => ({ id, roles: { highest: { position } } }) as never;
  const guild = (botPosition: number) => ({ ownerId: 'owner', members: { me: m('bot', botPosition) } });

  it('allows a moderator to act on a lower member when the bot is above them too', () => {
    expect(hierarchyProblem(guild(10), m('mod', 5), m('member', 1))).toBeNull();
  });

  it('blocks self, the owner, the bot, equal or higher ranks, and members above the bot', () => {
    expect(hierarchyProblem(guild(10), m('mod', 5), m('mod', 5))).toMatch(/yourself/);
    expect(hierarchyProblem(guild(10), m('mod', 5), m('owner', 1))).toMatch(/owner/);
    expect(hierarchyProblem(guild(10), m('mod', 5), m('bot', 10))).toMatch(/myself/);
    expect(hierarchyProblem(guild(10), m('mod', 5), m('peer', 5))).toMatch(/same as or above yours/);
    expect(hierarchyProblem(guild(3), m('mod', 5), m('member', 4))).toMatch(/above mine/);
  });

  it('lets the owner act on anyone below the bot', () => {
    expect(hierarchyProblem(guild(10), m('owner', 1), m('admin', 9))).toBeNull();
  });
});
