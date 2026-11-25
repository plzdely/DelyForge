import { describe, expect, it } from 'vitest';
import {
  EMBED_LIMITS,
  TEMPLATES,
  blankEmbed,
  buildersSchema,
  customCommandSchema,
  embedSchema,
  guildModulesSchema,
  newItemId,
  workflowSchema,
} from '../src/index.js';

const G = '123456789012345678';
const cmd = (patch: Record<string, unknown> = {}) => ({
  id: 'c1',
  enabled: true,
  type: 'slash',
  name: 'hello',
  description: 'Say hello',
  options: [],
  access: 'everyone',
  cooldownSeconds: 0,
  response: { text: 'Hi {user}!', embedId: '', ephemeral: false, buttons: [] },
  ...patch,
});

describe('custom commands', () => {
  it('accepts a simple slash command', () => {
    expect(customCommandSchema.safeParse(cmd()).success).toBe(true);
  });

  it('enforces Discord naming rules and reserved names', () => {
    expect(customCommandSchema.safeParse(cmd({ name: 'Hello World' })).success).toBe(false);
    expect(customCommandSchema.safeParse(cmd({ name: 'ban' })).success).toBe(false);
    expect(customCommandSchema.safeParse(cmd({ type: 'user', name: 'Give Hug', description: '' })).success).toBe(true);
  });

  it('needs a reply, puts required options first, and blocks options on right-click commands', () => {
    expect(customCommandSchema.safeParse(cmd({ response: { text: ' ', embedId: '', ephemeral: false, buttons: [] } })).success).toBe(false);
    const opt = (name: string, required: boolean) => ({ name, description: 'x', type: 'text', required });
    expect(customCommandSchema.safeParse(cmd({ options: [opt('a', true), opt('b', false)] })).success).toBe(true);
    expect(customCommandSchema.safeParse(cmd({ options: [opt('a', false), opt('b', true)] })).success).toBe(false);
    expect(customCommandSchema.safeParse(cmd({ type: 'message', name: 'Report', options: [opt('a', true)] })).success).toBe(false);
  });

  it('only allows https link buttons', () => {
    const withButton = (url: string) => cmd({ response: { text: 'x', embedId: '', ephemeral: false, buttons: [{ label: 'Site', url }] } });
    expect(customCommandSchema.safeParse(withButton('https://example.com')).success).toBe(true);
    expect(customCommandSchema.safeParse(withButton('javascript:alert(1)')).success).toBe(false);
    expect(customCommandSchema.safeParse(withButton('http://example.com')).success).toBe(false);
  });
});

describe('embeds', () => {
  it('accepts the blank embed and enforces the 6,000 character total', () => {
    expect(embedSchema.safeParse(blankEmbed('e1')).success).toBe(true);
    const fields = Array.from({ length: 6 }, (_, i) => ({ name: `F${i}`, value: 'x'.repeat(EMBED_LIMITS.fieldValue), inline: false }));
    const big = { ...blankEmbed('e1'), description: 'y'.repeat(EMBED_LIMITS.description), fields };
    expect(embedSchema.safeParse(big).success).toBe(false);
  });

  it('rejects an empty embed', () => {
    expect(embedSchema.safeParse({ ...blankEmbed('e1'), title: '', description: '' }).success).toBe(false);
  });
});

describe('workflows', () => {
  const wf = (patch: Record<string, unknown> = {}) => ({
    id: 'w1',
    name: 'Greet',
    enabled: true,
    guildId: G,
    trigger: { type: 'memberJoin' },
    steps: [{ type: 'wait', seconds: 5 }, { type: 'sendDM', text: 'Welcome!' }],
    ...patch,
  });

  it('accepts a valid workflow', () => {
    expect(workflowSchema.safeParse(wf()).success).toBe(true);
  });

  it('limits total waiting and rejects steps that do not fit the trigger', () => {
    expect(workflowSchema.safeParse(wf({ steps: [{ type: 'wait', seconds: 3600 }, { type: 'wait', seconds: 1 }] })).success).toBe(false);
    expect(workflowSchema.safeParse(wf({ steps: [{ type: 'reply', text: 'hi' }] })).success).toBe(false);
    expect(workflowSchema.safeParse(wf({ trigger: { type: 'memberLeave' }, steps: [{ type: 'addRole', roleId: G }] })).success).toBe(false);
    expect(workflowSchema.safeParse(wf({ steps: [] })).success).toBe(false);
  });
});

describe('builders as a whole', () => {
  it('catches duplicate names and links to deleted embeds', () => {
    expect(buildersSchema.safeParse({ commands: [cmd(), cmd({ id: 'c2' })], embeds: [], workflows: [] }).success).toBe(false);
    const usesEmbed = cmd({ response: { text: '', embedId: 'e9', ephemeral: false, buttons: [] } });
    expect(buildersSchema.safeParse({ commands: [usesEmbed], embeds: [], workflows: [] }).success).toBe(false);
    expect(buildersSchema.safeParse({ commands: [usesEmbed], embeds: [blankEmbed('e9')], workflows: [] }).success).toBe(true);
  });

  it('makes new unique IDs', () => {
    expect(newItemId([])).toBe('i1');
    expect(newItemId([{ id: 'i1' }, { id: 'i2' }])).toBe('i3');
  });
});

describe('templates', () => {
  it('has 10 valid templates with unique IDs', () => {
    expect(TEMPLATES).toHaveLength(10);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(10);
    for (const t of TEMPLATES) {
      expect(guildModulesSchema.safeParse(t.modules).success, t.id).toBe(true);
      expect(buildersSchema.safeParse({ commands: t.commands, embeds: [], workflows: [] }).success, t.id).toBe(true);
    }
  });
});

describe('workflow blocks and new steps', () => {
  const base = { id: 'w9', name: 'x', enabled: true, guildId: '123456789012345678' };
  const ok = (trigger: unknown, steps: unknown[]) => workflowSchema.safeParse({ ...base, trigger, steps }).success;
  it('needs If blocks to line up', () => {
    const check = { kind: 'text', text: '{var:a}', op: 'equals', value: '1', negate: false };
    expect(ok({ type: 'memberJoin' }, [{ type: 'if', check }, { type: 'sendDM', text: 'a' }, { type: 'else' }, { type: 'sendDM', text: 'b' }, { type: 'endIf' }])).toBe(true);
    expect(ok({ type: 'memberJoin' }, [{ type: 'if', check }, { type: 'sendDM', text: 'a' }])).toBe(false);
    expect(ok({ type: 'memberJoin' }, [{ type: 'endIf' }])).toBe(false);
    expect(ok({ type: 'memberJoin' }, [{ type: 'if', check }, { type: 'else' }, { type: 'else' }, { type: 'endIf' }])).toBe(false);
  });
  it('keeps member-only steps away from scheduled runs', () => {
    const sched = { type: 'schedule', time: '09:00', days: [], timezone: 'UTC' };
    expect(ok(sched, [{ type: 'sendRandom', channelId: '123456789012345678', texts: ['a', 'b'] }])).toBe(true);
    expect(ok(sched, [{ type: 'sendDM', text: 'hi' }])).toBe(false);
    expect(ok(sched, [{ type: 'timeout', minutes: 5 }])).toBe(false);
    expect(ok(sched, [{ type: 'if', check: { kind: 'hasRole', roleId: '123456789012345678', negate: false } }, { type: 'endIf' }])).toBe(false);
    expect(ok({ type: 'reactionAdded', emoji: '✅', channelId: null }, [{ type: 'createThread', name: 'Talk about {user.name}' }])).toBe(true);
    expect(ok({ type: 'memberJoin' }, [{ type: 'createThread', name: 'x' }])).toBe(false);
  });
});

