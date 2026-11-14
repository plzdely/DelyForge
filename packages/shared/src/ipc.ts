import { z } from 'zod';
import {
  type AppNotification,
  type BotEvent,
  type BotLogEntry,
  type BotProject,
  type BotRuntimeState,
  type ExportResult,
  type ImportResult,
  botIdInputSchema,
  connectBotSchema,
  createBotProjectSchema,
  logsListSchema,
  markNotificationsSchema,
  updateBotProjectSchema,
} from './bots.js';
import type { Entitlements } from './entitlements.js';
import { appSettingsPatchSchema, type AppSettings } from './settings.js';
import type { PlanId } from './plans.js';

/**
 * Typed IPC contract between the desktop renderer (UI) and the main process.
 *
 * Every channel is listed here once. The main process validates each payload against `ipcInputSchemas` before acting,
 * so the (untrusted) renderer cannot send unexpected data. See ARCHITECTURE.md §4.
 */

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  dashboardGetSummary: 'dashboard:get-summary',
  shellOpenExternal: 'shell:open-external',
  accountGetEntitlements: 'account:get-entitlements',
  botsList: 'bots:list',
  botsGet: 'bots:get',
  botsCreate: 'bots:create',
  botsUpdate: 'bots:update',
  botsDuplicate: 'bots:duplicate',
  botsDelete: 'bots:delete',
  botsExport: 'bots:export',
  botsImport: 'bots:import',
  botsConnect: 'bots:connect',
  botsDisconnect: 'bots:disconnect',
  runtimeStates: 'runtime:states',
  runtimeStart: 'runtime:start',
  runtimeStop: 'runtime:stop',
  runtimeRestart: 'runtime:restart',
  runtimeStartAll: 'runtime:start-all',
  runtimeStopAll: 'runtime:stop-all',
  logsList: 'logs:list',
  logsClear: 'logs:clear',
  logsExport: 'logs:export',
  notificationsList: 'notifications:list',
  notificationsMarkRead: 'notifications:mark-read',
  notificationsClear: 'notifications:clear',
  clipboardWrite: 'clipboard:write',
} as const;
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Main → renderer push channel (not invokable). */
export const BOT_EVENT_CHANNEL = 'bots:event';

/** Hosts the app may open in the user's browser. Keeps a compromised UI from opening arbitrary URLs. */
export const EXTERNAL_URL_ALLOWLIST = [
  'discord.com',
  'support.discord.com',
  'docs.discord.com',
  'github.com',
] as const;

export function isAllowedExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    return EXTERNAL_URL_ALLOWLIST.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const noInput = z.undefined();

export const ipcInputSchemas = {
  [IPC_CHANNELS.appGetInfo]: noInput,
  [IPC_CHANNELS.settingsGet]: noInput,
  [IPC_CHANNELS.settingsUpdate]: appSettingsPatchSchema,
  [IPC_CHANNELS.dashboardGetSummary]: noInput,
  [IPC_CHANNELS.shellOpenExternal]: z
    .string()
    .max(2048)
    .refine(isAllowedExternalUrl, { message: 'URL is not on the allow-list' }),
  [IPC_CHANNELS.accountGetEntitlements]: noInput,
  [IPC_CHANNELS.botsList]: noInput,
  [IPC_CHANNELS.botsGet]: botIdInputSchema,
  [IPC_CHANNELS.botsCreate]: createBotProjectSchema,
  [IPC_CHANNELS.botsUpdate]: updateBotProjectSchema,
  [IPC_CHANNELS.botsDuplicate]: botIdInputSchema,
  [IPC_CHANNELS.botsDelete]: botIdInputSchema,
  [IPC_CHANNELS.botsExport]: botIdInputSchema,
  [IPC_CHANNELS.botsImport]: noInput,
  [IPC_CHANNELS.botsConnect]: connectBotSchema,
  [IPC_CHANNELS.botsDisconnect]: botIdInputSchema,
  [IPC_CHANNELS.runtimeStates]: noInput,
  [IPC_CHANNELS.runtimeStart]: botIdInputSchema,
  [IPC_CHANNELS.runtimeStop]: botIdInputSchema,
  [IPC_CHANNELS.runtimeRestart]: botIdInputSchema,
  [IPC_CHANNELS.runtimeStartAll]: noInput,
  [IPC_CHANNELS.runtimeStopAll]: noInput,
  [IPC_CHANNELS.logsList]: logsListSchema,
  [IPC_CHANNELS.logsClear]: botIdInputSchema,
  [IPC_CHANNELS.logsExport]: botIdInputSchema,
  [IPC_CHANNELS.notificationsList]: noInput,
  [IPC_CHANNELS.notificationsMarkRead]: markNotificationsSchema,
  [IPC_CHANNELS.notificationsClear]: noInput,
  [IPC_CHANNELS.clipboardWrite]: z.string().min(1).max(4000),
} as const satisfies Record<IpcChannel, z.ZodType>;

// ---------------------------------------------------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------------------------------------------------

export type IpcErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'LIMIT_REACHED'
  | 'CONFLICT'
  | 'DISCORD_REJECTED'
  | 'NETWORK'
  | 'INTERNAL';

export interface IpcError {
  code: IpcErrorCode;
  message: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

// ---------------------------------------------------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------------------------------------------------

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  electron: string;
  node: string;
  chrome: string;
  dataDirectory: string;
}

export type ActivityKind = 'app' | 'bot' | 'module' | 'workflow' | 'account' | 'system';

export interface ActivityItem {
  id: number;
  kind: ActivityKind;
  message: string;
  createdAt: string; // ISO 8601
}

export interface DashboardSummary {
  totalProjects: number;
  onlineBots: number;
  offlineBots: number;
  /** Sum of the last known server counts of every bot. */
  totalServers: number;
  /** Slash commands handled by all bots, all time. */
  totalCommands: number;
  unreadNotifications: number;
  recentActivity: ActivityItem[];
  /** Plan applied locally. Until accounts ship (Phase 7) this is always the Free plan. */
  localPlanId: PlanId;
  /** False until the cloud account system is connected. */
  accountConnected: boolean;
}

/** The API exposed to the renderer as `window.delyforge`. */
export interface DelyForgeBridge {
  app: {
    getInfo(): Promise<IpcResult<AppInfo>>;
  };
  settings: {
    get(): Promise<IpcResult<AppSettings>>;
    update(patch: z.input<typeof appSettingsPatchSchema>): Promise<IpcResult<AppSettings>>;
  };
  dashboard: {
    getSummary(): Promise<IpcResult<DashboardSummary>>;
  };
  shell: {
    openExternal(url: string): Promise<IpcResult<null>>;
  };
  account: {
    getEntitlements(): Promise<IpcResult<AccountEntitlements>>;
  };
  bots: {
    list(): Promise<IpcResult<BotProject[]>>;
    get(id: string): Promise<IpcResult<BotProject>>;
    create(input: z.input<typeof createBotProjectSchema>): Promise<IpcResult<BotProject>>;
    update(input: z.input<typeof updateBotProjectSchema>): Promise<IpcResult<BotProject>>;
    duplicate(id: string): Promise<IpcResult<BotProject>>;
    remove(id: string): Promise<IpcResult<null>>;
    exportToFile(id: string): Promise<IpcResult<ExportResult>>;
    importFromFile(): Promise<IpcResult<ImportResult>>;
    /** Verifies the token with Discord, then stores it encrypted. The token is never returned. */
    connect(id: string, token: string): Promise<IpcResult<BotProject>>;
    disconnect(id: string): Promise<IpcResult<BotProject>>;
  };
  runtime: {
    states(): Promise<IpcResult<BotRuntimeState[]>>;
    start(id: string): Promise<IpcResult<BotRuntimeState>>;
    stop(id: string): Promise<IpcResult<BotRuntimeState>>;
    restart(id: string): Promise<IpcResult<BotRuntimeState>>;
    startAll(): Promise<IpcResult<{ started: number; skipped: number }>>;
    stopAll(): Promise<IpcResult<{ stopped: number }>>;
  };
  logs: {
    list(id: string, limit?: number): Promise<IpcResult<BotLogEntry[]>>;
    clear(id: string): Promise<IpcResult<null>>;
    exportToFile(id: string): Promise<IpcResult<ExportResult>>;
  };
  notifications: {
    list(): Promise<IpcResult<AppNotification[]>>;
    markRead(ids?: number[]): Promise<IpcResult<null>>;
    clear(): Promise<IpcResult<null>>;
  };
  clipboard: {
    writeText(text: string): Promise<IpcResult<null>>;
  };
  events: {
    /** Subscribe to live bot events. Returns an unsubscribe function. */
    onBotEvent(listener: (event: BotEvent) => void): () => void;
  };
}

/** Entitlements as resolved by the main process (the UI never decides what a customer may use). */
export interface AccountEntitlements extends Omit<Entitlements, 'graceEndsAt'> {
  graceEndsAt: string | null;
  /** `local` until accounts ship; `dev-override` only in unpackaged development builds. */
  source: 'local' | 'dev-override' | 'account';
}
