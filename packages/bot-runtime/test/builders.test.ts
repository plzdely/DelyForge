import { type Builders, type CustomCommand, type Workflow, blankEmbed } from '@delyforge/shared';
import { describe, expect, it } from 'vitest';
import { allowRun, commandKey, customCommandJSON, matchingWorkflows, renderEmbed, runWorkflow, takeCooldown } from '../src/modules/builders.js';
import type { ModuleContext } from '../src/modules/context.js';

const G = '123456789012345678';
const command = (patch: Partial<CustomCommand> = {}): CustomCommand => ({
  id: 'c1',
  enabled: true,
  type: 'slash',
  name: 'hello',
  description: 'Say hello',
  options: [{ name: 'who', description: 'Who', type: 'user', required: true }],
  access: 'moderators',
  cooldownSeconds: 10,
  response: { text: 'Hi', embedId: '', ephemeral: false, buttons: [] },
  ...patch,
});

describe('custom command definitions', () => {
  it('builds slash commands with options and permission presets', () => {
    const json = customCommandJSON(command()) as { type: number; options: { type: number; name: string }[]; default_member_permissions: string };
    expect(json.type).toBe(1);
    expect(json.options).toEqual([{ type: 6, name: 'who', description: 'Who', required: true }]);
    expect(json.default_member_permissions).toBe(String(1n << 13n));
    expect((customCommandJSON(command({ access: 'everyone' })) as { default_member_permissions: unknown }).default_member_permissions).toBeNull();
  });

  it('builds right-click commands and keys them apart from slash commands', () => {
    expect(customCommandJSON(command({ type: 'user', name: 'Hug', options: [] })).type).toBe(2);
    expect(customCommandJSON(command({ type: 'message', name: 'Report', options: [] })).type).toBe(3);
    expect(commandKey({ type: 'slash', name: 'hug' })).toBe('hug');
    expect(commandKey({ type: 'user', name: 'Hug' })).toBe('user:Hug');
  });
});

describe('embeds', () => {
  it('renders variables into the embed', () => {
    const e = renderEmbed({ ...blankEmbed('e1'), title: 'Hi {user.name}', fields: [{ name: 'Server', value: '{server}', inline: true }] }, { 'user.name': 'Dely', server: 'Aurora' });
    expect(e.title).toBe('Hi Dely');
    expect(e.fields).toEqual([{ name: 'Server', value: 'Aurora', inline: true }]);
    expect(e.color).toBe(0x7c5cff);
  });
});

describe('limits', () => {
  it('applies per-user cooldowns', () => {
    const map = new Map<string, number>();
    expect(takeCooldown('k', 10, 0, map)).toBe(0);
    expect(takeCooldown('k', 10, 4000, map)).toBe(6);
    expect(takeCooldown('k', 10, 10_000, map)).toBe(0);
    expect(takeCooldown('k', 0, 10_001, map)).toBe(0);
  });

  it('caps workflow runs at 30 a minute', () => {
    const map = new Map<string, number[]>();
    for (let n = 0; n < 30; n++) expect(allowRun('w', 1000 + n, map)).toBe(true);
    expect(allowRun('w', 2000, map)).toBe(false);
    expect(allowRun('w', 70_000, map)).toBe(true);
  });
});

describe('workflow engine', () => {
  const wf = (patch: Partial<Workflow> = {}): Workflow => ({
    id: 'w1',
    name: 'Greet',
    enabled: true,
    guildId: G,
    trigger: { type: 'memberJoin' },
    steps: [{ type: 'wait', seconds: 5 }, { type: 'sendDM', text: 'Welcome {user.name} to {server}!' }],
    ...patch,
  });

  it('matches triggers by server, keyword, channel and role', () => {
    const list = [
      wf(),
      wf({ id: 'w2', trigger: { type: 'messageContains', keyword: 'Help', channelId: null } }),
      wf({ id: 'w3', trigger: { type: 'roleAdded', roleId: G } }),
      wf({ id: 'w4', enabled: false }),
    ];
    expect(matchingWorkflows(list, G, { type: 'memberJoin' }).map((w) => w.id)).toEqual(['w1']);
    expect(matchingWorkflows(list, G, { type: 'messageContains', text: 'I need HELP please', channelId: 'c' }).map((w) => w.id)).toEqual(['w2']);
    expect(matchingWorkflows(list, G, { type: 'roleAdded', roleId: G }).map((w) => w.id)).toEqual(['w3']);
    expect(matchingWorkflows(list, 'other', { type: 'memberJoin' })).toEqual([]);
  });

  function fakeRun(workflow: Workflow, accountAgeDays: number) {
    const runs: Parameters<ModuleContext['workflowRun']>[0][] = [];
    const dms: string[] = [];
    const waits: number[] = [];
    const ctx = { workflowRun: (r: (typeof runs)[number]) => runs.push(r) } as unknown as ModuleContext;
    const user = { id: '1', username: 'dely', createdTimestamp: Date.now() - accountAgeDays * 86_400_000, send: async (m: { content: string }) => void dms.push(m.content) };
    const guild = { name: 'Aurora', memberCount: 10 };
    const builders: Builders = { commands: [], embeds: [], workflows: [workflow] };
    return {
      runs,
      dms,
      waits,
      go: () => runWorkflow(ctx, builders, workflow, { guild, user, member: null } as never, async (ms) => void waits.push(ms)),
    };
  }

  it('runs steps in order with waits and variables', async () => {
    const r = fakeRun(wf({ id: 'wa' }), 30);
    await r.go();
    expect(r.waits).toEqual([5000]);
    expect(r.dms).toEqual(['Welcome dely to Aurora!']);
    expect(r.runs[0]).toMatchObject({ workflowId: 'wa', ok: true, steps: 2 });
  });

  it('stops at a condition that is not met', async () => {
    const r = fakeRun(wf({ id: 'wb', steps: [{ type: 'ifAccountOlderThan', days: 7 }, { type: 'sendDM', text: 'hi' }] }), 1);
    await r.go();
    expect(r.dms).toEqual([]);
    expect(r.runs[0]).toMatchObject({ ok: true, steps: 1 });
    expect(r.runs[0]!.message).toMatch(/younger than 7/);
  });

  it('reports a failing step', async () => {
    const r = fakeRun(wf({ id: 'wc', steps: [{ type: 'addRole', roleId: G }] }), 30);
    await r.go();
    expect(r.runs[0]).toMatchObject({ ok: false, steps: 0 });
    expect(r.runs[0]!.message).toMatch(/member not available/);
  });
});
