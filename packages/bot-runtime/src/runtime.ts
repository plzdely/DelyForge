import {
  type BotModules,
  type BotPresence,
  type FromRuntime,
  type LogLevel,
  type RuntimeFatalCode,
  type RuntimeOptions,
  createRedactor,
  toRuntimeSchema,
} from '@delyforge/shared';

/** Events a Discord client adapter reports back to the runtime. */
export interface BotClientEvents {
  ready(info: { id: string; tag: string; avatarUrl: string | null; guildCount: number }): void;
  log(level: LogLevel, message: string): void;
  connection(state: 'disconnected' | 'reconnecting' | 'resumed'): void;
  command(name: string, ok: boolean, durationMs: number): void;
}

/** Minimal surface the runtime needs from a Discord client — lets tests use a fake instead of discord.js. */
export interface BotClient {
  login(token: string): Promise<void>;
  destroy(): Promise<void>;
  setPresence(presence: BotPresence): void;
  setModules(modules: BotModules): void;
  ping(): number | null;
  guildCount(): number;
}

export type CreateClient = (options: RuntimeOptions, events: BotClientEvents) => BotClient;

export interface RuntimeDeps {
  send(message: FromRuntime): void;
  createClient: CreateClient;
  exit(code: number): void;
  heartbeatMs?: number;
}

/** Turns discord.js login errors into codes the supervisor and UI understand. */
export function classifyLoginError(err: unknown): { code: RuntimeFatalCode; message: string } {
  const e = err as { code?: unknown; message?: unknown; status?: unknown };
  const msg = typeof e?.message === 'string' ? e.message : String(err);
  if (e?.code === 'TokenInvalid' || e?.status === 401 || /invalid token|401/i.test(msg)) {
    return {
      code: 'INVALID_TOKEN',
      message: 'Discord rejected the bot token. It may have been reset — reconnect the bot with a new token.',
    };
  }
  if (/disallowed intent/i.test(msg) || e?.code === 4014) {
    return {
      code: 'DISALLOWED_INTENTS',
      message:
        'This bot asks for a privileged intent that is not enabled. Turn it on in the Developer Portal (Bot → Privileged Gateway Intents).',
    };
  }
  return { code: 'LOGIN_FAILED', message: `Could not log in to Discord: ${msg}` };
}

/**
 * The bot runtime state machine. It only runs DelyForge's own built-in behaviour, configured by validated options —
 * it never evaluates user-supplied code.
 */
export function createBotRuntime(deps: RuntimeDeps) {
  const redact = createRedactor();
  const heartbeatMs = deps.heartbeatMs ?? 5000;
  let client: BotClient | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let startedAt = 0;
  let lastCpu = process.cpuUsage();
  let lastCpuAt = Date.now();
  let stopping = false;

  const log = (level: LogLevel, message: string) =>
    deps.send({ type: 'log', level, message: redact(message).slice(0, 4000) });

  const sendHeartbeat = () => {
    if (!client) return;
    const now = Date.now();
    const cpu = process.cpuUsage(lastCpu);
    const elapsedMicros = Math.max(1, (now - lastCpuAt) * 1000);
    lastCpu = process.cpuUsage();
    lastCpuAt = now;
    const mem = process.memoryUsage();
    deps.send({
      type: 'heartbeat',
      metrics: {
        pingMs: client.ping(),
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        cpuPercent: Math.round(((cpu.user + cpu.system) / elapsedMicros) * 1000) / 10,
        guildCount: client.guildCount(),
        uptimeMs: now - startedAt,
      },
    });
  };

  const stop = async (code: number) => {
    if (stopping) return;
    stopping = true;
    if (heartbeat) clearInterval(heartbeat);
    try {
      await client?.destroy();
    } catch {
      // Shutting down anyway.
    }
    deps.send({ type: 'stopped' });
    deps.exit(code);
  };

  const handle = async (raw: unknown): Promise<void> => {
    const parsed = toRuntimeSchema.safeParse(raw);
    if (!parsed.success) {
      log('warn', 'Ignored an invalid message from the supervisor.');
      return;
    }
    const msg = parsed.data;

    if (msg.type === 'stop') {
      log('info', 'Stopping…');
      await stop(0);
      return;
    }

    if (msg.type === 'set-presence') {
      client?.setPresence(msg.presence);
      return;
    }

    if (msg.type === 'set-modules') {
      client?.setModules(msg.modules);
      return;
    }

    // start
    if (client) {
      log('warn', 'Already started.');
      return;
    }
    redact.addSecret(msg.token);
    startedAt = Date.now();
    log('info', 'Connecting to Discord…');
    client = deps.createClient(msg.options, {
      ready: (info) => {
        client?.setPresence(msg.options.presence);
        deps.send({ type: 'ready', user: { id: info.id, tag: info.tag, avatarUrl: info.avatarUrl }, guildCount: info.guildCount });
        log('info', `Logged in as ${info.tag} — in ${info.guildCount} server${info.guildCount === 1 ? '' : 's'}.`);
        sendHeartbeat();
      },
      log,
      connection: (state) => deps.send({ type: 'connection', state }),
      command: (name, ok, durationMs) => deps.send({ type: 'command', name, ok, durationMs }),
    });

    try {
      await client.login(msg.token);
      heartbeat = setInterval(sendHeartbeat, heartbeatMs);
    } catch (err) {
      const fatal = classifyLoginError(err);
      deps.send({ type: 'fatal', code: fatal.code, message: redact(fatal.message) });
      await stop(1);
    }
  };

  return { handle, log };
}
