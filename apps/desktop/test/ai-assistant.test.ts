import { type AiProposal, type Builders, EMPTY_BUILDERS, type GuildInfo, buildersSchema } from '@delyforge/shared';
import { describe, expect, it } from 'vitest';
import { AiAssistant } from '../src/main/ai-assistant';
import { AppError } from '../src/main/errors';

const BOT = '11111111-1111-4111-8111-111111111111';
const GUILD: GuildInfo = {
  id: '100000000000000001',
  name: 'Test',
  iconUrl: null,
  channels: [{ id: '200000000000000001', name: 'welcome', kind: 'text', parentId: null, position: 0 }],
  roles: [
    { id: '100000000000000001', name: '@everyone', color: 0, position: 0, managed: false },
    { id: '300000000000000001', name: 'Member', color: 0, position: 1, managed: false },
    { id: '300000000000000002', name: 'SomeBot', color: 0, position: 2, managed: true },
  ],
  botRolePosition: 5,
  botPermissions: '0',
};
const TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.GaBcDe.' + 'abcdefghijklmnopqrstuvwxyz0123456789';

const PROPOSAL: AiProposal = {
  summary: 'Sets things up.',
  modules: [
    { moduleId: 'welcome', config: { enabled: true } },
    { moduleId: 'leveling', config: { enabled: true } },
  ],
  commands: [
    { enabled: true, type: 'slash', name: 'rules', description: 'Rules', options: [], access: 'everyone', cooldownSeconds: 0, response: { text: 'Be nice', embedId: '', ephemeral: false, buttons: [] } },
    { enabled: true, type: 'slash', name: 'taken', description: 'Dup', options: [], access: 'everyone', cooldownSeconds: 0, response: { text: 'x', embedId: '', ephemeral: false, buttons: [] } },
  ],
  workflows: [{ name: 'Greet', enabled: true, trigger: { type: 'memberJoin' }, steps: [{ type: 'addRole', roleId: '300000000000000001' }] }],
  notes: [],
  dropped: [],
};

function setup() {
  const sent: { method: string; path: string; body: unknown }[] = [];
  let saved: Builders = { ...EMPTY_BUILDERS, commands: [{ ...PROPOSAL.commands[1]!, id: 'i1' }] };
  const updates: string[] = [];
  const api = {
    authed: async <T,>(method: string, path: string, body?: unknown) => {
      sent.push({ method, path, body });
      if (path === '/v1/ai/bot-builder') return { proposalId: 'p1', proposal: PROPOSAL, creditsUsed: 7, usage: { configured: true, used: 7, limit: 300, resetsAt: '' } } as T;
      return null as T;
    },
  };
  const ai = new AiAssistant(
    api,
    { get: () => ({ id: BOT, name: 'Bot' }) } as never,
    {
      guilds: async () => [GUILD],
      update: (_b, _g, moduleId) => {
        if (moduleId === 'leveling') throw new AppError('FORBIDDEN', 'Leveling is available on the Pro plan.');
        updates.push(moduleId);
        return { modules: {}, restartRequired: true };
      },
    },
    {
      get: () => structuredClone(saved),
      save: (_id, raw) => (saved = buildersSchema.parse(raw)),
    },
    { list: () => [{ id: 1, botId: BOT, level: 'error', message: `login with ${TOKEN} failed`, createdAt: 't' }] },
    () => ({ status: 'error', lastError: { message: 'bad token' } }),
  );
  return { ai, sent, updates, saved: () => saved };
}

describe('AiAssistant', () => {
  it('sends only names and IDs, without bot-managed roles or @everyone', async () => {
    const { ai, sent } = setup();
    await ai.build(BOT, GUILD.id, 'Welcome new members please');
    const body = sent[0]!.body as { guild: { roles: { id: string }[] } };
    expect(body.guild.roles.map((r) => r.id)).toEqual(['300000000000000001']);
  });

  it('applies approved items through the normal services and reports what it skipped', async () => {
    const { ai, sent, updates, saved } = setup();
    await ai.build(BOT, GUILD.id, 'Welcome new members please');
    const result = await ai.apply('p1');
    expect(updates).toEqual(['welcome']);
    expect(result.applied).toEqual(['Welcome module', 'Command /rules', 'Automation “Greet”']);
    expect(result.skipped).toHaveLength(2); // leveling not in plan + name clash
    expect(result.restartRequired).toBe(true);
    expect(saved().workflows[0]).toMatchObject({ name: 'Greet', guildId: GUILD.id });
    expect(sent.at(-1)).toMatchObject({ path: '/v1/ai/proposals/p1/decision', body: { decision: 'applied' } });
    await expect(ai.apply('p1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('removes tokens from logs before asking for troubleshooting help', async () => {
    const { ai, sent } = setup();
    await ai.troubleshoot(BOT, '');
    expect(JSON.stringify(sent[0]!.body)).not.toContain(TOKEN);
  });
});
