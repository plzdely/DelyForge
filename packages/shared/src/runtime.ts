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

/** Messages the "Send a test" buttons can post, using the bot owner as the example member. */
export const MODULE_TESTS = ['welcome', 'goodbye', 'levelUp', 'birthday', 'scheduled', 'feeds'] as const;
export type ModuleTest = (typeof MODULE_TESTS)[number];
/** One problem found by the Setup Doctor, in plain English. */
export const doctorIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  moduleId: z.string().max(40).nullable(),
  title: z.string().max(300),
  fix: z.string().max(400),
  /** Server permissions to add (decimal), for the re-invite link. */
  permissions: z.string().regex(/^\d{1,20}$/).nullable(),
});
export type DoctorIssue = z.infer<typeof doctorIssueSchema>;
export const doctorInputSchema = z.object({ id: z.uuid(), guildId: z.string().regex(/^\d{17,20}$/) }).strict();

/** "Send message": the bot posts something you wrote, in a server channel or as a DM. */
export const sendMessageTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('channel'), guildId: z.string().regex(/^\d{17,20}$/), channelId: z.string().regex(/^\d{17,20}$/) }).strict(),
  z.object({ kind: z.literal('dm'), userId: z.string().regex(/^\d{17,20}$/, 'Paste a user ID (17–20 digits)') }).strict(),
]);
export const sendMessageContentSchema = z
  .object({
    target: sendMessageTargetSchema,
    content: z.string().max(2000),
    /** One of the bot's saved embeds (or '' for none). */
    embedId: z.union([z.literal(''), z.string().regex(/^[a-z0-9]{1,16}$/)]),
    /** Let @user, @role and @everyone mentions in the text actually ping. */
    allowPings: z.boolean(),
  })
  .strict()
  .refine((m) => m.content.trim() !== '' || m.embedId !== '', 'Write a message or choose an embed');
export const sendMessageInputSchema = z.object({ id: z.uuid(), message: sendMessageContentSchema }).strict();
export type SendMessageInput = z.infer<typeof sendMessageContentSchema>;

export const moduleTestSchema = z
  .object({ id: z.uuid(), guildId: z.string().regex(/^\d{17,20}$/), test: z.enum(MODULE_TESTS) })
  .strict();

/** Supervisor → runtime. The token only ever travels over this private channel. */
export const toRuntimeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), token: z.string().min(1), options: runtimeOptionsSchema }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('set-presence'), presence: presenceSchema }),
  /** Live settings change — applied without a restart (unless new intents are needed). */
  z.object({ type: z.literal('set-modules'), modules: botModulesSchema }),
  z.object({ type: z.literal('set-builders'), builders: buildersSchema }),
  z.object({ type: z.literal('test-module'), requestId: z.string().min(1).max(40), guildId: z.string().regex(/^\d{17,20}$/), test: z.enum(MODULE_TESTS) }),
  /** DM the bot's owner (the person who owns the application in the Developer Portal) about a problem. */
  z.object({ type: z.literal('notify-owner'), text: z.string().min(1).max(1800) }),
  z.object({ type: z.literal('doctor'), requestId: z.string().min(1).max(40), guildId: z.string().regex(/^\d{17,20}$/) }),
  z.object({ type: z.literal('send-message'), requestId: z.string().min(1).max(40), message: sendMessageContentSchema }),
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
  z.object({ type: z.literal('test-result'), requestId: z.string().max(40), ok: z.boolean(), message: z.string().max(500) }),
  z.object({ type: z.literal('send-result'), requestId: z.string().max(40), ok: z.boolean(), message: z.string().max(500), url: z.string().max(300).nullable() }),
  z.object({ type: z.literal('doctor-result'), requestId: z.string().max(40), ok: z.boolean(), message: z.string().max(500), issues: z.array(doctorIssueSchema).max(100) }),
  /** Something the owner should fix, e.g. the bot lost permissions a module needs. */
  z.object({ type: z.literal('problem'), kind: z.enum(['permissions']), message: z.string().max(1000) }),
]);
export type FromRuntime = z.infer<typeof fromRuntimeSchema>;
