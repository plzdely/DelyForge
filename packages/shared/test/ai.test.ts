import { describe, expect, it } from 'vitest';
import { type AiGuildContext, creditsFor, validateProposal } from '../src/ai.js';

const GUILD: AiGuildContext = {
  id: '100000000000000001',
  name: 'Test',
  channels: [{ id: '200000000000000001', name: 'welcome', kind: 'text' }],
  roles: [{ id: '300000000000000001', name: 'Member' }],
};
const empty = { summary: 's', modules: [], commandsJson: [], workflowsJson: [], notes: [] };

describe('creditsFor', () => {
  it('charges at least one credit and weights output tokens', () => {
    expect(creditsFor(0, 0)).toBe(1);
    expect(creditsFor(4000, 2000)).toBe(7);
  });
});

describe('validateProposal', () => {
  it('merges partial module settings onto the defaults and keeps valid IDs', () => {
    const p = validateProposal(
      { ...empty, modules: [{ moduleId: 'welcome', settingsJson: JSON.stringify({ enabled: true, welcome: { enabled: true, channelId: '200000000000000001' }, autoRoles: { roleIds: ['300000000000000001'] } }) }] },
      GUILD,
    );
    expect(p.dropped).toEqual([]);
    expect(p.modules[0]).toMatchObject({ moduleId: 'welcome', config: { enabled: true, welcome: { enabled: true, channelId: '200000000000000001' } } });
  });

  it('drops settings that point at invented channels, invalid JSON and schema failures', () => {
    const p = validateProposal(
      {
        ...empty,
        modules: [
          { moduleId: 'welcome', settingsJson: JSON.stringify({ enabled: true, welcome: { enabled: true, channelId: '299999999999999999' } }) },
          { moduleId: 'logging', settingsJson: '{not json' },
          { moduleId: 'utility', settingsJson: JSON.stringify({ enabled: 'yes' }) },
        ],
      },
      GUILD,
    );
    expect(p.modules).toEqual([]);
    expect(p.dropped).toHaveLength(3);
  });

  it('validates commands and workflows, clears embed references and fills in IDs', () => {
    const p = validateProposal(
      {
        ...empty,
        commandsJson: [
          JSON.stringify({ enabled: true, type: 'slash', name: 'rules', description: 'Show the rules', options: [], access: 'everyone', cooldownSeconds: 0, response: { text: 'Be nice', embedId: 'i9', ephemeral: false, buttons: [] } }),
          JSON.stringify({ type: 'slash', name: 'Bad Name' }),
        ],
        workflowsJson: [
          JSON.stringify({ name: 'Greet', enabled: true, trigger: { type: 'memberJoin' }, steps: [{ type: 'addRole', roleId: '300000000000000001' }] }),
          JSON.stringify({ name: 'Ghost', enabled: true, trigger: { type: 'memberJoin' }, steps: [{ type: 'addRole', roleId: '399999999999999999' }] }),
        ],
      },
      GUILD,
    );
    expect(p.commands).toHaveLength(1);
    expect(p.commands[0]!.response.embedId).toBe('');
    expect(p.commands[0]).not.toHaveProperty('id');
    expect(p.workflows.map((w) => w.name)).toEqual(['Greet']);
    expect(p.dropped).toHaveLength(2);
  });
});
