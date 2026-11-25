import {
  type AppSettings,
  type BotEvent,
  type BotRuntimeState,
  DEFAULT_PLANS,
  type Entitlements,
  type FromRuntime,
  type ModuleTest,
  type NotificationType,
  type RuntimeOptions,
  type ToRuntime,
  INTENT_BITS,
  applyEntitlementsToModules,
  builderIntents,
  computeIntents,
  createRedactor,
  fromRuntimeSchema,
} from '@delyforge/shared';
import { randomUUID } from 'node:crypto';
import type { BotRepository } from '../db/bots';
import type { LogRepository, NotificationRepository } from '../db/logs';
import type { AnalyticsRepository } from '../db/analytics';
import type { SecretRepository } from '../db/secrets';
import { AppError } from '../errors';

/** A running bot process, abstracted so tests can use a fake and cloud hosting can plug in later. */
export interface RuntimeProcess {
  readonly pid: number | undefined;
  postMessage(message: ToRuntime): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number | null) => void): void;
  /** Output the process writes outside the protocol (e.g. a crash trace on stderr). */
  onOutput(listener: (text: string, stream: 'stdout' | 'stderr') => void): void;
  kill(): void;
}

export type Launcher = (botName: string) => RuntimeProcess;

export interface SupervisorTimings {
  /** Delays before each automatic restart attempt. */
  backoffMs: number[];
  stopTimeoutMs: number;
  heartbeatTimeoutMs: number;
  watchdogIntervalMs: number;
  crashWindowMs: number;
  crashLimit: number;
  disconnectNoticeMs: number;
  highMemoryBytes: number;
}

export const DEFAULT_TIMINGS: SupervisorTimings = {
  backoffMs: [2_000, 5_000, 15_000, 30_000, 60_000],
  stopTimeoutMs: 5_000,
  heartbeatTimeoutMs: 45_000,
  watchdogIntervalMs: 5_000,
  crashWindowMs: 10 * 60_000,
  crashLimit: 5,
  disconnectNoticeMs: 60_000,
  highMemoryBytes: 512 * 1024 * 1024,
};

export interface SupervisorDeps {
  launcher: Launcher;
  bots: BotRepository;
  secrets: SecretRepository;
  logs: LogRepository;
  notifications: NotificationRepository;
  settings: () => AppSettings;
  entitlements: () => Pick<Entitlements, 'limits' | 'effectivePlanId' | 'features'>;
  /** Folder for each bot's own runtime data (one SQLite file per bot). */
  dataDir: string;
  emit: (event: BotEvent) => void;
  /** Records automation runs reported by the bot. */
  onWorkflowRun?: (botId: string, run: { workflowId: string; ok: boolean; steps: number; message: string }) => void;
  /** Daily statistics (optional so tests can leave it out). */
  analytics?: Pick<AnalyticsRepository, 'command' | 'heartbeat' | 'crash' | 'stopped'>;
  /** Shows an OS notification (respecting user preferences is done here, not by the caller). */
  desktopNotify?: (title: string, body: string) => void;
  timings?: Partial<SupervisorTimings>;
}

interface Handle {
  state: BotRuntimeState;
  proc: RuntimeProcess | null;
  stopRequested: boolean;
  fatal: boolean;
  crashTimes: number[];
  autoRestarting: boolean;
  lastHeartbeatAt: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  restartCountdown: ReturnType<typeof setInterval> | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  killTimer: ReturnType<typeof setTimeout> | null;
  stopWaiters: (() => void)[];
  highMemoryNotified: boolean;
  /** Gateway intents the running process connected with. */
  intents: number;
  /** "Send a test" requests waiting for the bot's answer. */
  tests: Map<string, (r: { ok: boolean; message: string }) => void>;
  /** Owner DMs waiting for the bot to be online again (e.g. written while it was crashed). */
  ownerDms: string[];
  lastOwnerDm: Map<NotificationType, number>;
}

/** Problems the bot also DMs its owner about (when enabled in Settings). */
const OWNER_DM_TYPES = new Set<NotificationType>(['bot.restarted', 'bot.crash_loop', 'bot.permission_lost']);
const OWNER_DM_EVERY_MS = 15 * 60_000;

const ACTIVE = new Set(['starting', 'online', 'reconnecting', 'stopping']);

function offlineState(botId: string): BotRuntimeState {
  return {
    botId,
    status: 'offline',
    startedAt: null,
    readyAt: null,
    pid: null,
    lastError: null,
    metrics: null,
    history: [],
    commandsThisSession: 0,
    restartCount: 0,
    restartInSeconds: null,
  };
}

/**
 * Runs and watches every bot process: start / stop / restart, crash detection, automatic restart with backoff,
 * crash-loop protection, heartbeat watchdog, logs, metrics and notifications. See ARCHITECTURE.md §7.
 */
export class BotSupervisor {
  private readonly handles = new Map<string, Handle>();
  private readonly t: SupervisorTimings;
  private readonly redact = createRedactor();
  private readonly watchdog: ReturnType<typeof setInterval>;

  constructor(private readonly d: SupervisorDeps) {
    this.t = { ...DEFAULT_TIMINGS, ...d.timings };
    this.watchdog = setInterval(() => this.checkHeartbeats(), this.t.watchdogIntervalMs);
    this.watchdog.unref?.();
  }

  // ─── Queries ─────────────────────────────────────────────────────────────────────────────────────────────────────

  state(botId: string): BotRuntimeState {
    return this.handles.get(botId)?.state ?? offlineState(botId);
  }

  states(): BotRuntimeState[] {
    return this.d.bots.list().map((b) => this.state(b.id));
  }

  onlineCount(): number {
    let n = 0;
    for (const h of this.handles.values()) if (h.state.status === 'online' || h.state.status === 'reconnecting') n++;
    return n;
  }

  private activeCount(except?: string): number {
    let n = 0;
    for (const [id, h] of this.handles) if (id !== except && ACTIVE.has(h.state.status)) n++;
    return n;
  }

  // ─── Commands ────────────────────────────────────────────────────────────────────────────────────────────────────

  start(botId: string): BotRuntimeState {
    const h = this.handle(botId);
    if (ACTIVE.has(h.state.status) && h.state.status !== 'stopping') return h.state;
    this.clearRestart(h);
    h.crashTimes = [];
    h.autoRestarting = false;
    return this.launch(botId, h);
  }

  /** Stops the bot and resolves once its process has exited. */
  async stop(botId: string): Promise<BotRuntimeState> {
    const h = this.handles.get(botId);
    if (!h) return offlineState(botId);
    this.clearRestart(h);
    if (!h.proc) {
      this.update(h, { status: 'offline', lastError: null, restartInSeconds: null, metrics: null });
      return h.state;
    }
    const done = new Promise<void>((resolve) => h.stopWaiters.push(resolve));
    if (h.state.status !== 'stopping') {
      h.stopRequested = true;
      this.update(h, { status: 'stopping', restartInSeconds: null });
      this.log(botId, 'info', 'Stop requested.');
      h.proc.postMessage({ type: 'stop' });
      h.killTimer = setTimeout(() => {
        this.log(botId, 'warn', 'The bot did not stop in time, so it was force-closed.');
        h.proc?.kill();
      }, this.t.stopTimeoutMs);
    }
    await done;
    return h.state;
  }

  async restart(botId: string): Promise<BotRuntimeState> {
    await this.stop(botId);
    return this.start(botId);
  }

  startAll(): { started: number; skipped: number } {
    let started = 0;
    let skipped = 0;
    for (const bot of this.d.bots.list()) {
      if (!bot.hasToken || !bot.isEnabled || ACTIVE.has(this.state(bot.id).status)) continue;
      try {
        this.start(bot.id);
        started++;
      } catch {
        skipped++;
      }
    }
    return { started, skipped };
  }

  async stopAll(): Promise<{ stopped: number }> {
    const active = [...this.handles.entries()].filter(([, h]) => h.proc || h.restartTimer);
    await Promise.all(active.map(([id]) => this.stop(id)));
    return { stopped: active.length };
  }

  /** Starts every bot marked "start when DelyForge opens". Failures are logged, not thrown. */
  startOnLaunch(): void {
    for (const bot of this.d.bots.list()) {
      if (!bot.autoStart || !bot.hasToken || !bot.isEnabled) continue;
      try {
        this.start(bot.id);
      } catch (err) {
        this.log(bot.id, 'warn', `Could not start automatically: ${(err as Error).message}`);
      }
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.watchdog);
    await this.stopAll();
  }

  /** Called when a project is deleted or disconnected. */
  async forget(botId: string): Promise<void> {
    await this.stop(botId);
    this.handles.delete(botId);
  }

  setPresence(botId: string): void {
    const h = this.handles.get(botId);
    if (h?.proc && h.state.status === 'online') {
      h.proc.postMessage({ type: 'set-presence', presence: this.d.bots.runtimeBasics(botId).presence });
    }
  }

  /** Everything the runtime needs, with modules limited to what the current plan allows. */
  runtimeOptions(botId: string): RuntimeOptions {
    const ent = this.d.entitlements();
    const modules = applyEntitlementsToModules(this.d.bots.modules(botId), ent.features);
    const stored = this.d.bots.builders(botId);
    // After a downgrade, only the first workflows the plan allows keep running (nothing is deleted).
    let allowed = ent.limits.maxWorkflows ?? Infinity;
    const workflows = stored.workflows.map((w) => (w.enabled && allowed-- > 0 ? w : { ...w, enabled: false }));
    const builders = { ...stored, workflows };
    return {
      ...this.d.bots.runtimeBasics(botId),
      modules,
      builders,
      intents: computeIntents(modules) | builderIntents(builders, INTENT_BITS),
      dataDir: this.d.dataDir,
    };
  }

  /**
   * Sends changed module settings to a running bot. Returns true if the change needs gateway intents the bot did not
   * connect with — those only take effect after a restart.
   */
  applyModules(botId: string): boolean {
    const h = this.handles.get(botId);
    if (!h?.proc || !(h.state.status === 'online' || h.state.status === 'starting' || h.state.status === 'reconnecting')) return false;
    const options = this.runtimeOptions(botId);
    h.proc.postMessage({ type: 'set-modules', modules: options.modules });
    return (options.intents & ~h.intents) !== 0;
  }

  /** Same as applyModules, for custom commands, embeds and workflows. */
  applyBuilders(botId: string): boolean {
    const h = this.handles.get(botId);
    if (!h?.proc || !(h.state.status === 'online' || h.state.status === 'starting' || h.state.status === 'reconnecting')) return false;
    const options = this.runtimeOptions(botId);
    h.proc.postMessage({ type: 'set-builders', builders: options.builders });
    return (options.intents & ~h.intents) !== 0;
  }

  /** Asks the running bot to post one test message. Resolves with what happened (never rejects). */
  testModule(botId: string, guildId: string, test: ModuleTest): Promise<{ ok: boolean; message: string }> {
    const h = this.handles.get(botId);
    if (!h?.proc || h.state.status !== 'online') return Promise.resolve({ ok: false, message: 'Start the bot first — tests are sent by the running bot.' });
    const requestId = randomUUID();
    const proc = h.proc;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        h.tests.delete(requestId);
        resolve({ ok: false, message: 'The bot didn’t answer within 20 seconds.' });
      }, 20_000);
      h.tests.set(requestId, (r) => {
        clearTimeout(timer);
        h.tests.delete(requestId);
        resolve(r);
      });
      proc.postMessage({ type: 'test-module', requestId, guildId, test });
    });
  }

  // ─── Process lifecycle ───────────────────────────────────────────────────────────────────────────────────────────

  private launch(botId: string, h: Handle): BotRuntimeState {
    const project = this.d.bots.get(botId);
    if (!project.hasToken) throw new AppError('VALIDATION_FAILED', 'Connect this bot to Discord before starting it.');

    const ent = this.d.entitlements();
    const max = ent.limits.maxBotProjects;
    if (max !== null && this.activeCount(botId) >= max) {
      const plan = DEFAULT_PLANS[ent.effectivePlanId];
      throw new AppError(
        'LIMIT_REACHED',
        `Your ${plan.name} plan can run ${max} bot${max === 1 ? '' : 's'} at a time. Stop another bot or upgrade your plan.`,
      );
    }

    const token = this.d.secrets.get(botId);
    if (!token) throw new AppError('VALIDATION_FAILED', 'Connect this bot to Discord before starting it.');
    this.redact.addSecret(token);

    const proc = this.d.launcher(project.name);
    h.proc = proc;
    h.stopRequested = false;
    h.fatal = false;
    h.highMemoryNotified = false;
    h.lastHeartbeatAt = Date.now();
    this.update(h, {
      status: 'starting',
      startedAt: new Date().toISOString(),
      readyAt: null,
      pid: proc.pid ?? null,
      lastError: null,
      metrics: null,
      history: [],
      commandsThisSession: 0,
      restartInSeconds: null,
    });
    this.log(botId, 'info', h.autoRestarting ? 'Restarting automatically…' : 'Starting bot…');

    proc.onMessage((raw) => this.onMessage(botId, h, proc, raw));
    proc.onOutput((text, stream) => {
      for (const line of text.split(/\r?\n/).filter(Boolean)) this.log(botId, stream === 'stderr' ? 'error' : 'info', line);
    });
    proc.onExit((code) => this.onExit(botId, h, proc, code));
    const options = this.runtimeOptions(botId);
    h.intents = options.intents;
    proc.postMessage({ type: 'start', token, options });
    return h.state;
  }

  private onMessage(botId: string, h: Handle, proc: RuntimeProcess, raw: unknown): void {
    if (h.proc !== proc) return; // message from an old process
    const parsed = fromRuntimeSchema.safeParse(raw);
    if (!parsed.success) return; // untrusted input — ignore anything off-protocol
    const msg: FromRuntime = parsed.data;
    h.lastHeartbeatAt = Date.now();
    // Electron assigns the PID shortly after launch — pick it up once the process is talking.
    if (h.state.pid === null && proc.pid !== undefined) this.update(h, { pid: proc.pid });

    switch (msg.type) {
      case 'log':
        this.log(botId, msg.level, msg.message);
        break;
      case 'ready': {
        const wasAutoRestart = h.autoRestarting;
        h.autoRestarting = false;
        this.d.bots.recordReady(botId, msg.user.tag, msg.user.avatarUrl, msg.guildCount);
        this.update(h, { status: 'online', readyAt: new Date().toISOString() });
        this.d.emit({ type: 'project-updated', botId });
        for (const text of h.ownerDms.splice(0)) proc.postMessage({ type: 'notify-owner', text });
        if (wasAutoRestart) {
          this.notify('bot.restarted', 'restarts', botId, 'Bot restarted', `${this.name(botId)} crashed and was restarted automatically. It is back online.`);
        }
        break;
      }
      case 'heartbeat': {
        const m = msg.metrics;
        const history = [...h.state.history, { t: Date.now(), pingMs: m.pingMs, rssMb: Math.round(m.rssBytes / 1048576), cpuPercent: m.cpuPercent }].slice(-60);
        this.update(h, { metrics: m, history });
        if (h.state.status === 'online') this.d.analytics?.heartbeat(botId);
        this.d.bots.recordGuildCount(botId, m.guildCount);
        if (m.rssBytes > this.t.highMemoryBytes && !h.highMemoryNotified) {
          h.highMemoryNotified = true;
          this.notify(
            'bot.high_memory',
            'highMemory',
            botId,
            'High memory usage',
            `${this.name(botId)} is using ${Math.round(m.rssBytes / 1048576)} MB of memory.`,
          );
        }
        break;
      }
      case 'command':
        this.d.bots.incrementCommands(botId);
        this.d.analytics?.command(botId, msg.name, msg.ok, msg.durationMs);
        this.update(h, { commandsThisSession: h.state.commandsThisSession + 1 });
        break;
      case 'connection':
        if (msg.state === 'resumed') {
          if (h.disconnectTimer) clearTimeout(h.disconnectTimer);
          h.disconnectTimer = null;
          if (h.state.status === 'reconnecting') this.update(h, { status: 'online' });
        } else if (h.state.status === 'online') {
          this.update(h, { status: 'reconnecting' });
          // Short blips are normal; only notify if the bot stays disconnected.
          h.disconnectTimer ??= setTimeout(() => {
            h.disconnectTimer = null;
            if (h.state.status === 'reconnecting') {
              this.notify('bot.disconnected', 'disconnects', botId, 'Bot disconnected', `${this.name(botId)} lost its connection to Discord and is still trying to reconnect.`);
            }
          }, this.t.disconnectNoticeMs);
        }
        break;
      case 'fatal':
        h.fatal = true;
        this.update(h, { status: 'error', lastError: { code: msg.code, message: msg.message } });
        this.log(botId, 'error', msg.message);
        this.notify('bot.login_failed', 'crashes', botId, 'Bot could not start', `${this.name(botId)}: ${msg.message}`);
        break;
      case 'workflow-run':
        this.d.onWorkflowRun?.(botId, msg);
        if (!msg.ok) this.log(botId, 'warn', `Workflow ${msg.workflowId}: ${msg.message}`);
        break;
      case 'stopped':
        this.d.analytics?.stopped(botId);
        break;
      case 'test-result':
        h.tests.get(msg.requestId)?.({ ok: msg.ok, message: msg.message });
        break;
      case 'problem':
        this.log(botId, 'warn', msg.message);
        this.notify('bot.permission_lost', 'permissions', botId, 'Bot lost permissions', `${this.name(botId)}: ${msg.message}`);
        break;
    }
  }

  private onExit(botId: string, h: Handle, proc: RuntimeProcess, code: number | null): void {
    if (h.proc !== proc) return;
    h.proc = null;
    if (h.killTimer) clearTimeout(h.killTimer);
    if (h.disconnectTimer) clearTimeout(h.disconnectTimer);
    h.killTimer = null;
    h.disconnectTimer = null;

    if (h.stopRequested) {
      this.update(h, { status: 'offline', pid: null, readyAt: null, metrics: null, lastError: null });
      this.log(botId, 'info', 'Bot stopped.');
    } else if (h.fatal) {
      // Login problems need the user's attention — restarting would fail the same way.
      this.update(h, { pid: null, readyAt: null, metrics: null });
    } else {
      this.onCrash(botId, h, code);
    }
    const waiters = h.stopWaiters.splice(0);
    for (const w of waiters) w();
    for (const answer of [...h.tests.values()]) answer({ ok: false, message: 'The bot stopped before it could send the test.' });
  }

  private onCrash(botId: string, h: Handle, code: number | null): void {
    const message = `The bot process stopped unexpectedly (exit code ${code ?? 'unknown'}).`;
    this.log(botId, 'error', message);
    this.update(h, { status: 'crashed', pid: null, readyAt: null, metrics: null, lastError: { code: 'CRASHED', message } });
    this.d.analytics?.crash(botId);

    let project;
    try {
      project = this.d.bots.get(botId);
    } catch {
      return; // project was deleted
    }

    const now = Date.now();
    h.crashTimes = [...h.crashTimes.filter((t) => now - t < this.t.crashWindowMs), now];

    if (!project.autoRestart) {
      this.notify('bot.crashed', 'crashes', botId, 'Bot crashed', `${project.name} stopped unexpectedly. Automatic restart is off.`);
      return;
    }
    if (h.crashTimes.length >= this.t.crashLimit) {
      this.update(h, { lastError: { code: 'CRASH_LOOP', message: `Crashed ${h.crashTimes.length} times in a short period, so automatic restarts were paused.` } });
      this.log(botId, 'error', 'Crashed repeatedly — automatic restarts paused. Check the console for the cause.');
      this.notify('bot.crash_loop', 'crashes', botId, 'Bot keeps crashing', `${project.name} crashed ${h.crashTimes.length} times in a short period. Automatic restarts were paused.`);
      return;
    }

    const delay = this.t.backoffMs[Math.min(h.crashTimes.length - 1, this.t.backoffMs.length - 1)] ?? 5_000;
    this.notify('bot.crashed', 'crashes', botId, 'Bot crashed', `${project.name} stopped unexpectedly. Restarting in ${Math.round(delay / 1000)} s.`);
    h.autoRestarting = true;
    let remaining = Math.ceil(delay / 1000);
    this.update(h, { restartInSeconds: remaining });
    h.restartCountdown = setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      this.update(h, { restartInSeconds: remaining });
    }, 1000);
    h.restartTimer = setTimeout(() => {
      this.clearRestart(h);
      try {
        this.update(h, { restartCount: h.state.restartCount + 1 });
        this.launch(botId, h);
      } catch (err) {
        h.autoRestarting = false;
        this.update(h, { status: 'error', lastError: { code: 'RESTART_FAILED', message: (err as Error).message } });
        this.log(botId, 'error', `Automatic restart failed: ${(err as Error).message}`);
      }
    }, delay);
  }

  /** Kills bots that stopped sending heartbeats (hung process). The crash path then takes over. */
  private checkHeartbeats(): void {
    const now = Date.now();
    for (const [botId, h] of this.handles) {
      if (h.proc && (h.state.status === 'online' || h.state.status === 'starting') && now - h.lastHeartbeatAt > this.t.heartbeatTimeoutMs) {
        this.log(botId, 'error', 'The bot stopped responding and was force-closed.');
        h.lastHeartbeatAt = now;
        h.proc.kill();
      }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private handle(botId: string): Handle {
    let h = this.handles.get(botId);
    if (!h) {
      h = {
        state: offlineState(botId),
        proc: null,
        stopRequested: false,
        fatal: false,
        crashTimes: [],
        autoRestarting: false,
        lastHeartbeatAt: 0,
        restartTimer: null,
        restartCountdown: null,
        disconnectTimer: null,
        killTimer: null,
        stopWaiters: [],
        highMemoryNotified: false,
        intents: 0,
        tests: new Map(),
        ownerDms: [],
        lastOwnerDm: new Map(),
      };
      this.handles.set(botId, h);
    }
    return h;
  }

  private clearRestart(h: Handle): void {
    if (h.restartTimer) clearTimeout(h.restartTimer);
    if (h.restartCountdown) clearInterval(h.restartCountdown);
    h.restartTimer = null;
    h.restartCountdown = null;
    if (h.state.restartInSeconds !== null) this.update(h, { restartInSeconds: null });
  }

  private update(h: Handle, patch: Partial<BotRuntimeState>): void {
    h.state = { ...h.state, ...patch };
    this.d.emit({ type: 'state', state: h.state });
  }

  private log(botId: string, level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    try {
      const entry = this.d.logs.append(botId, level, this.redact(message));
      this.d.emit({ type: 'log', entry });
    } catch {
      // The project may have been deleted while its process was shutting down.
    }
  }

  /** The bot DMs its owner — now if it's online, otherwise once it's back. At most one DM per problem type per 15 min. */
  private dmOwner(botId: string, type: NotificationType, text: string): void {
    const h = this.handles.get(botId);
    if (!h) return;
    const now = Date.now();
    if (now - (h.lastOwnerDm.get(type) ?? 0) < OWNER_DM_EVERY_MS) return;
    h.lastOwnerDm.set(type, now);
    const message = text.slice(0, 1800);
    if (h.proc && h.state.status === 'online') h.proc.postMessage({ type: 'notify-owner', text: message });
    else h.ownerDms = [...h.ownerDms, message].slice(-3);
  }

  private name(botId: string): string {
    try {
      return this.d.bots.get(botId).name;
    } catch {
      return 'A bot';
    }
  }

  private notify(
    type: NotificationType,
    pref: keyof AppSettings['notifications'],
    botId: string,
    title: string,
    body: string,
  ): void {
    const prefs = this.d.settings().notifications;
    if (!prefs[pref]) return;
    try {
      const notification = this.d.notifications.create(type, title, body, botId);
      this.d.emit({ type: 'notification', notification });
      if (prefs.desktop) this.d.desktopNotify?.(title, body);
      if (prefs.discordDm && OWNER_DM_TYPES.has(type)) this.dmOwner(botId, type, `⚠️ **${title}** — ${body}\n-# Sent by DelyForge. Turn these off in Settings → Notifications.`);
    } catch {
      // Never let a notification failure affect the bot.
    }
  }
}
