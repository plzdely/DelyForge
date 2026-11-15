import { z } from 'zod';
import { presenceSchema } from './discord.js';
import { buildersSchema } from './builders.js';
import { botModulesSchema } from './modules.js';

/**
 * Protocol between the desktop main process (supervisor) and a bot runtime process.
 * Both directions are validated: the supervisor treats runtime messages as untrusted input.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const runtimeOptionsSchema = z.object({
  intents: z.number().int().nonnegative(),
  presence: presenceSchema,
  builtinPing: z.boolean(),
  /** Module settings per server, already filtered to what the plan allows. */
  modules: botModulesSchema,
  /** Folder where the runtime keeps this bot's own data (warnings, XP, managed commands…). */
  dataDir: z.string().min(1).max(1000),
  /** Custom commands, saved embeds and workflows. */
  builders: buildersSchema,
});
export type RuntimeOptions = z.infer<typeof runtimeOptionsSchema>;

/** Supervisor → runtime. The token only ever travels over this private channel. */
export const toRuntimeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), token: z.string().min(1), options: runtimeOptionsSchema }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('set-presence'), presence: presenceSchema }),
  /** Live settings change — applied without a restart (unless new intents are needed). */
  z.object({ type: z.literal('set-modules'), modules: botModulesSchema }),
  z.object({ type: z.literal('set-builders'), builders: buildersSchema }),
]);
export type ToRuntime = z.infer<typeof toRuntimeSchema>;

export const runtimeMetricsSchema = z.object({
  pingMs: z.number().nullable(),
  rssBytes: z.number().nonnegative(),
  heapUsedBytes: z.number().nonnegative(),
  cpuPercent: z.number().nonnegative(),
  guildCount: z.number().int().nonnegative(),
  uptimeMs: z.number().nonnegative(),
});
export type RuntimeMetrics = z.infer<typeof runtimeMetricsSchema>;

export const RUNTIME_FATAL_CODES = ['INVALID_TOKEN', 'DISALLOWED_INTENTS', 'LOGIN_FAILED', 'STARTUP_ERROR'] as const;
export type RuntimeFatalCode = (typeof RUNTIME_FATAL_CODES)[number];

/** Runtime → supervisor. */
export const fromRuntimeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('log'), level: z.enum(LOG_LEVELS), message: z.string().max(4000) }),
  z.object({
    type: z.literal('ready'),
    user: z.object({ id: z.string(), tag: z.string(), avatarUrl: z.string().nullable() }),
    guildCount: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('heartbeat'), metrics: runtimeMetricsSchema }),
  z.object({ type: z.literal('command'), name: z.string().max(100), ok: z.boolean(), durationMs: z.number().nonnegative() }),
  z.object({ type: z.literal('connection'), state: z.enum(['disconnected', 'reconnecting', 'resumed']) }),
  z.object({ type: z.literal('fatal'), code: z.enum(RUNTIME_FATAL_CODES), message: z.string().max(1000) }),
  z.object({ type: z.literal('stopped') }),
  z.object({
    type: z.literal('workflow-run'),
    workflowId: z.string().max(16),
    ok: z.boolean(),
    steps: z.number().int().nonnegative(),
    message: z.string().max(500),
  }),
]);
export type FromRuntime = z.infer<typeof fromRuntimeSchema>;
