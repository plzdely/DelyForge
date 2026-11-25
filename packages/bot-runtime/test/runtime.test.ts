import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { BotPresence, FromRuntime } from '@delyforge/shared';
import { describe, expect, it } from 'vitest';
import { type BotClientEvents, classifyLoginError, createBotRuntime } from '../src/index.js';

const FAKE_TOKEN = 'MTAxMjM0NTY3ODkwMTIzNDU2Nw.GaBcDe.' + 'abcdefghijklmnopqrstuvwxyz0123456789AB';
const OPTIONS = {
  intents: 1,
  presence: { status: 'online', activity: null } as BotPresence,
  builtinPing: true,
  modules: {},
  dataDir: 'C:/delyforge-test',
  builders: { commands: [], embeds: [], workflows: [] },
};

function harness(opts: { loginError?: unknown } = {}) {
  const sent: FromRuntime[] = [];
  const exits: number[] = [];
  let events!: BotClientEvents;
  const presences: BotPresence[] = [];
  let destroyed = false;
  const runtime = createBotRuntime({
    send: (m) => sent.push(m),
    exit: (c) => exits.push(c),
    heartbeatMs: 20,
    createClient: (_o, e) => {
      events = e;
      return {
        login: async () => {
          if (opts.loginError) throw opts.loginError;
        },
        destroy: async () => {
          destroyed = true;
        },
        setPresence: (p) => presences.push(p),
        setModules: () => {},
        setBuilders: () => {},
        runTest: async () => ({ ok: true, message: "test" }),
        notifyOwner: async () => true,
        doctor: () => ({ ok: true, message: '', issues: [] }),
        sendMessage: async () => ({ ok: true, message: 'sent', url: null }),
        ping: () => 42,
        guildCount: () => 3,
      };
    },
  });
  return { runtime, sent, exits, presences, get events() { return events; }, get destroyed() { return destroyed; } };
}

describe('bot runtime', () => {
  it('logs in, reports ready, sets presence and sends heartbeats', async () => {
    const h = harness();
    await h.runtime.handle({ type: 'start', token: FAKE_TOKEN, options: OPTIONS });
    h.events.ready({ id: '1', tag: 'Aurora#0001', avatarUrl: null, guildCount: 3 });
    await new Promise((r) => setTimeout(r, 60));

    expect(h.sent.find((m) => m.type === 'ready')).toMatchObject({ user: { tag: 'Aurora#0001' }, guildCount: 3 });
    expect(h.presences[0]).toEqual(OPTIONS.presence);
    const beat = h.sent.find((m) => m.type === 'heartbeat');
    expect(beat).toMatchObject({ metrics: { pingMs: 42, guildCount: 3 } });
  });

  it('never lets the token appear in logs', async () => {
    const h = harness();
    await h.runtime.handle({ type: 'start', token: FAKE_TOKEN, options: OPTIONS });
    h.events.log('error', `request failed with Authorization: Bot ${FAKE_TOKEN}`);
    h.events.log('info', `token=${FAKE_TOKEN.split('.')[0]}.${FAKE_TOKEN.split('.')[1]}.${FAKE_TOKEN.split('.')[2]}`);
    const logs = h.sent.filter((m) => m.type === 'log').map((m) => (m as { message: string }).message);
    expect(logs.join('\n')).not.toContain(FAKE_TOKEN);
  });

  it('reports a fatal INVALID_TOKEN and exits when Discord rejects the token', async () => {
    const h = harness({ loginError: Object.assign(new Error('An invalid token was provided.'), { code: 'TokenInvalid' }) });
    await h.runtime.handle({ type: 'start', token: FAKE_TOKEN, options: OPTIONS });
    expect(h.sent.find((m) => m.type === 'fatal')).toMatchObject({ code: 'INVALID_TOKEN' });
    expect(h.exits).toEqual([1]);
  });

  it('stops cleanly on request', async () => {
    const h = harness();
    await h.runtime.handle({ type: 'start', token: FAKE_TOKEN, options: OPTIONS });
    await h.runtime.handle({ type: 'stop' });
    expect(h.destroyed).toBe(true);
    expect(h.sent.at(-1)).toEqual({ type: 'stopped' });
    expect(h.exits).toEqual([0]);
  });

  it('ignores malformed supervisor messages', async () => {
    const h = harness();
    await h.runtime.handle({ type: 'eval', code: 'process.exit()' });
    expect(h.sent).toEqual([{ type: 'log', level: 'warn', message: 'Ignored an invalid message from the supervisor.' }]);
    expect(h.exits).toEqual([]);
  });

  it('applies presence changes while running', async () => {
    const h = harness();
    await h.runtime.handle({ type: 'start', token: FAKE_TOKEN, options: OPTIONS });
    const p: BotPresence = { status: 'dnd', activity: { type: 'watching', text: 'the server' } };
    await h.runtime.handle({ type: 'set-presence', presence: p });
    expect(h.presences.at(-1)).toEqual(p);
  });
});

describe('classifyLoginError', () => {
  it('maps discord.js errors to codes', () => {
    expect(classifyLoginError({ code: 'TokenInvalid', message: 'x' }).code).toBe('INVALID_TOKEN');
    expect(classifyLoginError(new Error('Used disallowed intents')).code).toBe('DISALLOWED_INTENTS');
    expect(classifyLoginError(new Error('getaddrinfo ENOTFOUND discord.com')).code).toBe('LOGIN_FAILED');
  });
});

describe('runtime process', () => {
  it('runs as a separate process and talks over the IPC channel', async () => {
    const entry = fileURLToPath(new URL('../dist/process.js', import.meta.url));
    const child = fork(entry, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const messages: FromRuntime[] = [];
    child.on('message', (m) => messages.push(m as FromRuntime));
    const code = await new Promise<number | null>((resolve) => {
      child.on('exit', resolve);
      child.send({ type: 'stop' });
    });
    expect(code).toBe(0);
    expect(messages).toContainEqual({ type: 'stopped' });
  });
});
