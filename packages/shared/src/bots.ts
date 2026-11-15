import { z } from 'zod';
import { type BotPresence, type PrivilegedIntentStatus, permissionsSchema, presenceSchema } from './discord.js';
import type { LogLevel, RuntimeMetrics } from './runtime.js';

/** Limits chosen to match what Discord itself allows for application names/descriptions. */
export const BOT_LIMITS = {
  nameMax: 32,
  descriptionMax: 400,
  groupMax: 32,
  /** Largest import file accepted (bytes). */
  importMaxBytes: 1024 * 1024,
} as const;

export const botIdSchema = z.uuid({ message: 'Invalid bot id' });

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Give your bot a name')
  .max(BOT_LIMITS.nameMax, `Names can be at most ${BOT_LIMITS.nameMax} characters`);

const descriptionSchema = z
  .string()
  .trim()
  .max(BOT_LIMITS.descriptionMax, `Descriptions can be at most ${BOT_LIMITS.descriptionMax} characters`);

/** Empty string → no group. */
const groupSchema = z
  .string()
  .trim()
  .max(BOT_LIMITS.groupMax, `Group names can be at most ${BOT_LIMITS.groupMax} characters`)
  .transform((v) => (v === '' ? null : v))
  .nullable();

/** A bot project as shown in the UI. Never contains the token — only whether one is stored. */
export interface BotProject {
  id: string;
  name: string;
  description: string;
  groupName: string | null;
  discordApplicationId: string | null;
  isFavorite: boolean;
  isEnabled: boolean;
  hasToken: boolean;
  /** e.g. "…x9Qa" — lets users recognise the stored token without revealing it. */
  tokenHint: string | null;
  /** Bot account details, captured when the token is verified. */
  botUsername: string | null;
  botAvatarUrl: string | null;
  /** Privileged intents enabled in the Developer Portal at last verification. */
  privilegedIntents: PrivilegedIntentStatus | null;
  presence: BotPresence;
  /** Invite permissions (64-bit, decimal string). */
  permissions: string;
  autoStart: boolean;
  autoRestart: boolean;
  builtinPing: boolean;
  /** Last known number of servers the bot is in. */
  guildCount: number;
  commandsExecuted: number;
  createdAt: string;
  updatedAt: string;
}

export const createBotProjectSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.default(''),
    groupName: groupSchema.default(null),
  })
  .strict();
export type CreateBotProjectInput = z.input<typeof createBotProjectSchema>;

export const updateBotProjectSchema = z
  .object({
    id: botIdSchema,
    patch: z
      .object({
        name: nameSchema,
        description: descriptionSchema,
        groupName: groupSchema,
        isFavorite: z.boolean(),
        presence: presenceSchema,
        permissions: permissionsSchema,
        autoStart: z.boolean(),
        autoRestart: z.boolean(),
        builtinPing: z.boolean(),
      })
      .partial()
      .strict()
      .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to update' }),
  })
  .strict();
export type UpdateBotProjectInput = z.input<typeof updateBotProjectSchema>;

export const botIdInputSchema = z.object({ id: botIdSchema }).strict();

/** The raw token is sent once, from the wizard to the main process, and never returned. */
export const connectBotSchema = z.object({ id: botIdSchema, token: z.string().min(1).max(200) }).strict();

// ─── Runtime state, logs, notifications ──────────────────────────────────────────────────────────────────────────

export type BotRuntimeStatus = 'offline' | 'starting' | 'online' | 'reconnecting' | 'stopping' | 'crashed' | 'error';

export interface BotRuntimeState {
  botId: string;
  status: BotRuntimeStatus;
  /** When the current process was started. */
  startedAt: string | null;
  /** When the bot last became ready (used for uptime). */
  readyAt: string | null;
  pid: number | null;
  lastError: { code: string; message: string } | null;
  metrics: RuntimeMetrics | null;
  /** Recent metric samples for sparklines (oldest first, ~5 s apart, max 60). */
  history: { t: number; pingMs: number | null; rssMb: number; cpuPercent: number }[];
  commandsThisSession: number;
  restartCount: number;
  /** Seconds until an automatic restart, when one is scheduled. */
  restartInSeconds: number | null;
}

export interface BotLogEntry {
  id: number;
  botId: string;
  level: LogLevel;
  message: string;
  createdAt: string;
}

export const logsListSchema = z
  .object({ id: botIdSchema, limit: z.number().int().min(1).max(2000).default(500) })
  .strict();

export const NOTIFICATION_TYPES = [
  'bot.crashed',
  'bot.crash_loop',
  'bot.restarted',
  'bot.disconnected',
  'bot.login_failed',
  'bot.high_memory',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  botId: string | null;
  readAt: string | null;
  createdAt: string;
}

export const markNotificationsSchema = z
  .object({ ids: z.array(z.number().int().positive()).max(1000).optional() })
  .strict();

/** Pushed from main to the UI as things happen. */
export type BotEvent =
  | { type: 'state'; state: BotRuntimeState }
  | { type: 'log'; entry: BotLogEntry }
  | { type: 'project-updated'; botId: string }
  | { type: 'notification'; notification: AppNotification }
  /** Sign-in state or plan changed. */
  | { type: 'account-updated' }
  /** A new version has downloaded and installs when the customer restarts. */
  | { type: 'update-ready'; version: string };

export type UpdateStatus =
  | { state: 'disabled' | 'idle' | 'checking' }
  | { state: 'downloading' | 'ready'; version: string }
  | { state: 'error'; message: string };

// ─── Export / import ─────────────────────────────────────────────────────────────────────────────────────────────

export const BOT_EXPORT_FORMAT = 'delyforge.bot-project';
export const BOT_EXPORT_VERSION = 1;

/**
 * Portable project file. Strict: unknown fields are rejected, so a file can never smuggle in a token or other data the
 * app does not expect. Tokens are never exported (SECURITY.md S1/S16).
 */
export const botProjectExportSchema = z
  .object({
    format: z.literal(BOT_EXPORT_FORMAT),
    version: z.literal(BOT_EXPORT_VERSION),
    exportedAt: z.iso.datetime(),
    appVersion: z.string().max(40),
    project: z
      .object({
        name: nameSchema,
        description: descriptionSchema,
        groupName: groupSchema,
        /** Module / command / workflow configuration (validated per-module from Phase 4). */
        config: z.record(z.string(), z.unknown()),
        // Added in 0.3 — optional so files exported by 0.2 still import.
        presence: presenceSchema.optional(),
        permissions: permissionsSchema.optional(),
        builtinPing: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export type BotProjectExport = z.infer<typeof botProjectExportSchema>;

export interface ExportResult {
  /** False when the user cancelled the save dialog. */
  saved: boolean;
  fileName: string | null;
}

export interface ImportResult {
  /** Null when the user cancelled the open dialog. */
  project: BotProject | null;
}

/** "My Bot" → "my-bot" for file names. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'bot'
  );
}

// ─── Analytics (Phase 9) ──────────────────────────────────────────────────────────────────────────────────────────

export interface AnalyticsReport {
  days: number;
  /** Oldest first, one entry per day (zeros for days without data). */
  daily: { day: string; onlineSeconds: number; commands: number; errors: number; crashes: number }[];
  /** Empty on plans without advanced analytics. */
  topCommands: { name: string; uses: number; errors: number; avgMs: number }[];
}

/** Basic analytics covers a week; advanced analytics covers 90 days, per-command stats and CSV export. */
export const ANALYTICS_DAYS = { basic: 7, advanced: 90 } as const;

// ─── Backups (Phase 9) ────────────────────────────────────────────────────────────────────────────────────────────

export interface BackupInfo {
  /** `YYYY-MM-DD.json` */
  file: string;
  createdAt: string;
  bots: { id: string; name: string }[];
}

// ─── Members tab: warnings and levels ─────────────────────────────────────────────────────────────────────────────

export interface MemberData {
  warnings: { id: number; userId: string; userName: string | null; moderatorName: string | null; reason: string; createdAt: string }[];
  /** Top 100 by XP. Names are remembered as members chat or get warned; older entries may only have an ID. */
  levels: { userId: string; name: string | null; xp: number; level: number }[];
}
