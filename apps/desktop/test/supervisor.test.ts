import { afterEach, describe, expect, it } from 'vitest';
import {
  type BotEvent,
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODULE_CONFIGS,
  INTENT_BITS,
  type ToRuntime,
  createBotProjectSchema,
  resolveEntitlements,
} from '@delyforge/shared';
import { BotRepository } from '../src/main/db/bots';
import { openDatabase } from '../src/main/db/database';
import { LogRepository, NotificationRepository } from '../src/main/db/logs';
import { ActivityRepository } from '../src/main/db/repositories';
import { type Cipher, SecretRepository } from '../src/main/db/secrets';
import { AppError } from '../src/main/errors';
import { BotSupervisor, type RuntimeProcess } from '../src/main/runtime/supervisor';

const TOKEN = 'MTAxMjM0NTY3ODkwMTIzNDU2Nw.GaBcDe.' + 'abcdefghijklmnopqrstuvwxyz0123456789AB';

/** Reversible stand-in for safeStorage. */
const fakeCipher: Cipher = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decrypt: (b) => Buffer.from(b.toString().slice(4), 'base64').toString(),
};

class FakeProcess implements RuntimeProcess {
  static all: FakeProcess[] = [];
  readonly pid = 1000 + FakeProcess.all.length;
  received: ToRuntime[] = [];
  killed = false;
  private messageListeners: ((m: unknown) => void)[] = [];
  private exitListeners: ((c: number | null) => void)[] = [];
  /** When true, a `stop` message makes the fake exit cleanly, like the real runtime. */
  exitOnStop = true;

  constructor() {
    FakeProcess.all.push(this);
  }
  postMessage(m: ToRuntime) {
    this.received.push(m);
    if (m.type === 'stop' && this.exitOnStop) setTimeout(() => this.exit(0), 1);
  }
  onMessage(l: (m: unknown) => void) {
    this.messageListeners.push(l);
  }
  onExit(l: (c: number | null) => void) {
    this.exitListeners.push(l);
  }
  onOutput() {}
  kill() {
    this.killed = true;
    setTimeout(() => this.exit(null), 1);
  }
  send(m: unknown) {
    for (const l of this.messageListeners) l(m);
  }
  exit(code: number | null) {
    for (const l of this.exitListeners) l(code);
  }
  ready() {
    this.send({ type: 'ready', user: { id: '1', tag: 'Aurora#0001', avatarUrl: null }, guildCount: 2 });
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const supervisors: BotSupervisor[] = [];

function setup(opts: { plan?: 'free' | 'pro'; autoRestart?: boolean; crashLimit?: number } = {}) {
  FakeProcess.all = [];
  const db = openDatabase(':memory:');
  const activity = new ActivityRepository(db);
  const ent = resolveEntitlements(
    (opts.plan ?? 'pro') === 'pro' ? { planId: 'pro', status: 'active' } : { planId: 'free', status: 'none' },
  );
  const bots = new BotRepository(db, activity, () => ent);
  const secrets = new SecretRepository(db, fakeCipher);
  const logs = new LogRepository(db);
  const notifications = new NotificationRepository(db);
  const events: BotEvent[] = [];
  const desktop: string[] = [];
  const supervisor = new BotSupervisor({
    launcher: () => new FakeProcess(),
    bots,
    secrets,
    logs,
    notifications,
    settings: () => DEFAULT_APP_SETTINGS,
    entitlements: () => ent,
    dataDir: 'C:/delyforge-test',
    emit: (e) => events.push(e),
    desktopNotify: (title) => desktop.push(title),
    timings: {
      backoffMs: [20, 40],
      stopTimeoutMs: 50,
      crashWindowMs: 10_000,
      crashLimit: opts.crashLimit ?? 3,
      heartbeatTimeoutMs: 60_000,
      watchdogIntervalMs: 60_000,
      disconnectNoticeMs: 30,
    },
  });
  supervisors.push(supervisor);

  const addBot = (name: string, connected = true) => {
    const bot = bots.create(createBotProjectSchema.parse({ name }));
    if (connected) {
      secrets.save(bot.id, TOKEN, `12345678901234567${bots.count()}`);
      if (opts.autoRestart === false) bots.update({ id: bot.id, patch: { autoRestart: false } });
    }
    return bot.id;
  };
  return { db, bots, secrets, logs, notifications, events, desktop, supervisor, addBot };
}

afterEach(async () => {
  for (const s of supervisors.splice(0)) await s.shutdown();
});

describe('BotSupervisor — start & stop', () => {
  it('starts a bot, passes the token only over the private channel, and goes online when ready', () => {
    const { supervisor, addBot } = setup();
    const id = addBot('Aurora');
    expect(supervisor.start(id).status).toBe('starting');
    const proc = FakeProcess.all[0]!;
    expect(proc.received[0]).toMatchObject({
      type: 'start',
      token: TOKEN,
      options: { intents: 1, builtinPing: true, modules: {}, dataDir: 'C:/delyforge-test' },
    });
    proc.ready();
    expect(supervisor.state(id)).toMatchObject({ status: 'online', pid: proc.pid });
    expect(supervisor.onlineCount()).toBe(1);
  });

  it('refuses to start a bot that is not connected', () => {
    const { supervisor, addBot } = setup();
    const id = addBot('Aurora', false);
    expect(() => supervisor.start(id)).toThrow(AppError);
  });

  it('is idempotent while already running', () => {
    const { supervisor, addBot } = setup();
    const id = addBot('Aurora');
    supervisor.start(id);
    supervisor.start(id);
    expect(FakeProcess.all).toHaveLength(1);
  });

  it('stops gracefully and resolves once the process has exited', async () => {
    const { supervisor, addBot } = setup();
    const id = addBot('Aurora');
    supervisor.start(id);
    FakeProcess.all[0]!.ready();
    const state = await supervisor.stop(id);
    expect(state.status).toBe('offline');
    expect(FakeProcess.all[0]!.received.at(-1)).toEqual({ type: 'stop' });
    expect(FakeProcess.all[0]!.killed).toBe(false);
  });

  it('force-closes a bot that does not stop in time', async () => {
    const { supervisor, addBot } = setup();
    const id = addBot('Aurora');
    supervisor.start(id);
    FakeProcess.all[0]!.exitOnStop = false;
    expect((await supervisor.stop(id)).status).toBe('offline');
    expect(FakeProcess.all[0]!.killed).toBe(true);
  });

  it('enforces how many bots can run at once on the plan', () => {
    const { supervisor, addBot, bots } = setup({ plan: 'pro' });
    const ids = ['A', 'B', 'C', 'D', 'E'].map((n) => addBot(n));
    for (const id of ids) supervisor.start(id);
    // Simulate a downgrade: 5 projects exist but Free allows 1 to run.
    const free = resolveEntitlements({ planId: 'free', status: 'none' });
    const s2 = new BotSupervisor({
      launcher: () => new FakeProcess(),
      bots,
      secrets: (supervisor as unknown as { d: { secrets: SecretRepository } }).d.secrets,
      logs: (supervisor as unknown as { d: { logs: LogRepository } }).d.logs,
      notifications: (supervisor as unknown as { d: { notifications: NotificationRepository } }).d.notifications,
      settings: () => DEFAULT_APP_SETTINGS,
      entitlements: () => free,
      dataDir: 'C:/delyforge-test',
      emit: () => {},
    });
    supervisors.push(s2);
    s2.start(ids[0]!);
    expect(() => s2.start(ids[1]!)).toThrow(/can run 1 bot/);
  });

  it('starts and stops all eligible bots', async () => {
    const { supervisor, addBot } = setup();
    addBot('A');
    addBot('B');
    addBot('Not connected', false);
    expect(supervisor.startAll()).toEqual({ started: 2, skipped: 0 });
    expect((await supervisor.stopAll()).stopped).toBe(2);
    expect(supervisor.onlineCount()).toBe(0);
  });
});

describe('BotSupervisor — crashes & recovery', () => {
  it('restarts a crashed bot automatically and notifies when it is back', async () => {
    const { supervisor, addBot, notifications } = setup();
    const id = addBot('Aurora');
    supervisor.start(id);
    FakeProcess.all[0]!.ready();
    FakeProcess.all[0]!.exit(1);
    expect(supervisor.state(id)).toMatchObject({ status: 'crashed', lastError: { code: 'CRASHED' } });
    expect(supervisor.state(id).restartInSeconds).not.toBeNull();

    await wait(40);
    expect(FakeProcess.all).toHaveLength(2);
    FakeProcess.all[1]!.ready();
    expect(supervisor.state(id)).toMatchObject({ status: 'online', restartCount: 1 });
    expect(notifications.list().map((n) => n.type)).toEqual(['bot.restarted', 'bot.crashed']);
  });

  it('does not restart when automatic restart is off', async () => {
    const { supervisor, addBot } = setup({ autoRestart: false });
    const id = addBot('Aurora');
    supervisor.start(id);
    FakeProcess.all[0]!.exit(1);
    await wait(60);
    expect(FakeProcess.all).toHaveLength(1);
    expect(supervisor.state(id).status).toBe('crashed');
  });

  it('pauses restarts after repeated crashes (crash loop)', async () => {
    const { supervisor, addBot, notifications } = setup({ crashLimit: 3 });
    const id = addBot('Aurora');
    supervisor.start(id);
    for (let i = 0; i < 3; i++) {
      FakeProcess.all.at(-1)!.exit(1);
      await wait(60);
    }
    expect(FakeProcess.all).toHaveLength(3);
    expect(supervisor.state(id).lastError?.code).toBe('CRASH_LOOP');
    expect(notifications.list()[0]?.type).toBe('bot.crash_loop');
  });

  it('never auto-restarts after a login failure (it would fail again)', async () => {
    const { supervisor, addBot, notifications } = setup();
    const id = addBot('Aurora');
    supervisor.start(id);
    FakeProcess.all[0]!.send({ type: 'fatal', code: 'INVALID_TOKEN', message: 'Discord rejected the bot token.' });
    FakeProcess.all[0]!.exit(1);
    await wait(60);
    expect(FakeProcess.all).toHaveLength(1);
    expect(supervisor.state(id)).toMatchObject({ status: 'error', lastError: { code: 'INVALID_TOKEN' } });
    expect(notifications.list()[0]?.type).toBe('bot.login_failed');
  });

  it('a manual stop cancels a scheduled restart', async () => {
    const { supervisor, addBot } = setup();
    const id = addBot('Aurora');
    supervisor.start(id);
    FakeProcess.all[0]!.exit(1);
    await supervisor.stop(id);
    await wait(60);
    expect(FakeProcess.all).toHaveLength(1);
    expect(supervisor.state(id).status).toBe('offline');
  });
});

describe('BotSupervisor — runtime messages', () => {
  it('records logs (redacting the token), metrics, commands and server counts', () => {
    const { supervisor, addBot, logs, bots } = setup();
    const id = addBot('Aurora');
    supervisor.start(id);
    const p = FakeProcess.all[0]!;
    p.ready();
    p.send({ type: 'log', level: 'error', message: `oops ${TOKEN}` });
    p.send({ type: 'heartbeat', metrics: { pingMs: 50, rssBytes: 80 * 1048576, heapUsedBytes: 1, cpuPercent: 1.5, guildCount: 4, uptimeMs: 1000 } });
    p.send({ type: 'command', name: 'ping', ok: true, durationMs: 12 });

    expect(logs.list(id).map((l) => l.message).join('\n')).not.toContain(TOKEN);
    expect(supervisor.state(id)).toMatchObject({ metrics: { pingMs: 50, guildCount: 4 }, commandsThisSession: 1 });
    expect(supervisor.state(id).history).toHaveLength(1);
    expect(bots.get(id)).toMatchObject({ guildCount: 4, commandsExecuted: 1, botUsername: 'Aurora#0001' });
  });

  it('ignores messages that do not follow the protocol', () => {
    const { supervisor, addBot } = setup();
    const id = addBot('Aurora');
    supervisor.start(id);
    FakeProcess.all[0]!.send({ type: 'ready', user: 'not-an-object' });
    FakeProcess.all[0]!.send('garbage');
    expect(supervisor.state(id).status).toBe('starting');
  });

  it('only notifies about disconnects that last, and recovers on resume', async () => {
    const { supervisor, addBot, notifications } = setup();
    const id = addBot('Aurora');
    supervisor.start(id);
    const p = FakeProcess.all[0]!;
    p.ready();
    p.send({ type: 'connection', state: 'disconnected' });
    expect(supervisor.state(id).status).toBe('reconnecting');
    p.send({ type: 'connection', state: 'resumed' });
    await wait(50);
    expect(supervisor.state(id).status).toBe('online');
    expect(notifications.list()).toHaveLength(0);

    p.send({ type: 'connection', state: 'disconnected' });
    await wait(50);
    expect(notifications.list()[0]?.type).toBe('bot.disconnected');
  });

  it('respects notification preferences and sends desktop notifications', () => {
    const { supervisor, addBot, desktop } = setup({ autoRestart: false });
    const id = addBot('Aurora');
    supervisor.start(id);
    FakeProcess.all[0]!.exit(1);
    expect(desktop).toEqual(['Bot crashed']);
  });
});

describe('BotSupervisor — modules', () => {
  const G = '123456789012345678';

  it('sends module settings filtered by plan, and computes intents from them', () => {
    const { supervisor, addBot, bots } = setup({ plan: 'free' });
    const id = addBot('Aurora');
    bots.setModules(id, {
      [G]: {
        welcome: { ...DEFAULT_MODULE_CONFIGS.welcome, enabled: true },
        logging: { ...DEFAULT_MODULE_CONFIGS.logging, enabled: true },
      },
    });
    supervisor.start(id);
    const start = FakeProcess.all[0]!.received[0] as Extract<ToRuntime, { type: 'start' }>;
    expect(start.options.modules[G]?.welcome?.enabled).toBe(true);
    expect(start.options.modules[G]?.logging?.enabled).toBe(false); // Pro module on Free
    expect(start.options.intents & INTENT_BITS['GuildMembers']!).not.toBe(0);
  });

  it('applies changes live and reports when new intents need a restart', () => {
    const { supervisor, addBot, bots } = setup();
    const id = addBot('Aurora');
    supervisor.start(id);
    FakeProcess.all[0]!.ready();

    bots.setModules(id, { [G]: { utility: { ...DEFAULT_MODULE_CONFIGS.utility, enabled: true } } });
    expect(supervisor.applyModules(id)).toBe(false);
    expect(FakeProcess.all[0]!.received.at(-1)).toMatchObject({ type: 'set-modules' });

    bots.setModules(id, { [G]: { welcome: { ...DEFAULT_MODULE_CONFIGS.welcome, enabled: true } } });
    expect(supervisor.applyModules(id)).toBe(true); // needs Server Members intent
  });

  it('does nothing for bots that are not running', () => {
    const { supervisor, addBot } = setup();
    expect(supervisor.applyModules(addBot('Aurora'))).toBe(false);
  });
});
