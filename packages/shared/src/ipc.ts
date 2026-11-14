import { z } from 'zod';
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
} as const;
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

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
} as const satisfies Record<IpcChannel, z.ZodType>;

// ---------------------------------------------------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------------------------------------------------

export type IpcErrorCode = 'VALIDATION_FAILED' | 'NOT_FOUND' | 'FORBIDDEN' | 'LIMIT_REACHED' | 'INTERNAL';

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
}
