import { z } from 'zod';
import { BASE_INTENTS, INTENT_BITS, snowflakeSchema } from './discord.js';
import type { FeatureKey } from './plans.js';

/**
 * Bot modules: what each module is, what it needs from Discord, and the validated shape of its settings.
 * Settings are stored per Discord server (guild), so one bot can behave differently in each server.
 * The same schemas are checked in the UI, the main process (before saving) and the bot runtime (before using).
 */

export const MODULE_IDS = [
  'welcome',
  'moderation',
  'logging',
  'utility',
  'leveling',
  'tickets',
  'verification',
  'reactionRoles',
  'suggestions',
  'giveaways',
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

// ─── Building blocks ──────────────────────────────────────────────────────────────────────────────────────────────

const channel = snowflakeSchema.nullable();
const roles = z.array(snowflakeSchema).max(25);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7c5cff');
const template = (max = 2000) => z.string().max(max, `At most ${max} characters`);

export const messageStyleSchema = z
  .object({
    /** Send as a rich embed instead of plain text. */
    embed: z.boolean(),
    color: hexColor,
    title: z.string().max(256),
  })
  .strict();

const ACTIONS = ['delete', 'warn', 'timeout'] as const;

// ─── Welcome ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const welcomeConfigSchema = z
  .object({
    enabled: z.boolean(),
    welcome: z
      .object({
        enabled: z.boolean(),
        channelId: channel,
        message: template(),
        style: messageStyleSchema,
      })
      .strict(),
    dm: z.object({ enabled: z.boolean(), message: template() }).strict(),
    goodbye: z.object({ enabled: z.boolean(), channelId: channel, message: template() }).strict(),
    autoRoles: z.object({ roleIds: roles }).strict(),
  })
  .strict();
export type WelcomeConfig = z.infer<typeof welcomeConfigSchema>;

// ─── Moderation ───────────────────────────────────────────────────────────────────────────────────────────────────

export const warnThresholdSchema = z
  .object({
    warnings: z.number().int().min(1).max(50),
    action: z.enum(['timeout', 'kick', 'ban']),
    /** For timeouts. Discord allows up to 28 days. */
    minutes: z.number().int().min(1).max(40320),
  })
  .strict();

export const moderationConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** Where moderation actions are recorded. */
    logChannelId: channel,
    /** Tell members by DM why they were warned/kicked/banned/timed out. */
    dmMembers: z.boolean(),
    thresholds: z.array(warnThresholdSchema).max(5),
    automod: z
      .object({
        /** Pro feature (`moderation.advanced`). */
        enabled: z.boolean(),
        exemptRoleIds: roles,
        timeoutMinutes: z.number().int().min(1).max(40320),
        spam: z
          .object({
            enabled: z.boolean(),
            maxMessages: z.number().int().min(2).max(30),
            perSeconds: z.number().int().min(2).max(60),
            action: z.enum(ACTIONS),
          })
          .strict(),
        links: z
          .object({
            enabled: z.boolean(),
            allowedDomains: z.array(z.string().trim().toLowerCase().max(100)).max(50),
            action: z.enum(ACTIONS),
          })
          .strict(),
        words: z
          .object({
            enabled: z.boolean(),
            words: z.array(z.string().trim().toLowerCase().min(1).max(64)).max(200),
            action: z.enum(ACTIONS),
          })
          .strict(),
        invites: z.object({ enabled: z.boolean(), action: z.enum(ACTIONS) }).strict(),
      })
      .strict(),
  })
  .strict();
export type ModerationConfig = z.infer<typeof moderationConfigSchema>;

// ─── Logging ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const LOG_EVENTS = ['messageDelete', 'messageEdit', 'memberJoin', 'memberLeave', 'memberRoles', 'channels', 'bans', 'voice'] as const;
export type LogEvent = (typeof LOG_EVENTS)[number];

export const loggingConfigSchema = z
  .object({
    enabled: z.boolean(),
    channelId: channel,
    events: z.object(Object.fromEntries(LOG_EVENTS.map((e) => [e, z.boolean()])) as Record<LogEvent, z.ZodBoolean>).strict(),
    ignoredChannelIds: z.array(snowflakeSchema).max(50),
  })
  .strict();
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;

// ─── Utility ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const utilityConfigSchema = z
  .object({
    enabled: z.boolean(),
    commands: z
      .object({ serverinfo: z.boolean(), userinfo: z.boolean(), avatar: z.boolean(), poll: z.boolean() })
      .strict(),
  })
  .strict();
export type UtilityConfig = z.infer<typeof utilityConfigSchema>;

// ─── Registry ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const moduleConfigSchemas = {
  welcome: welcomeConfigSchema,
  moderation: moderationConfigSchema,
  logging: loggingConfigSchema,
  utility: utilityConfigSchema,
} as const;
export type ImplementedModuleId = keyof typeof moduleConfigSchemas;
export const IMPLEMENTED_MODULES = Object.keys(moduleConfigSchemas) as ImplementedModuleId[];

export function isImplementedModule(id: string): id is ImplementedModuleId {
  return id in moduleConfigSchemas;
}

export interface ModuleConfigs {
  welcome: WelcomeConfig;
  moderation: ModerationConfig;
  logging: LoggingConfig;
  utility: UtilityConfig;
}

export const DEFAULT_MODULE_CONFIGS: ModuleConfigs = {
  welcome: {
    enabled: false,
    welcome: {
      enabled: true,
      channelId: null,
      message: 'Welcome to **{server}**, {user}! You are member #{memberCount}. 🎉',
      style: { embed: true, color: '#7c5cff', title: 'Welcome!' },
    },
    dm: { enabled: false, message: 'Hi {user.name}, welcome to {server}! Make sure to read the rules.' },
    goodbye: { enabled: false, channelId: null, message: '**{user.name}** has left the server. 👋' },
    autoRoles: { roleIds: [] },
  },
  moderation: {
    enabled: false,
    logChannelId: null,
    dmMembers: true,
    thresholds: [{ warnings: 3, action: 'timeout', minutes: 60 }],
    automod: {
      enabled: false,
      exemptRoleIds: [],
      timeoutMinutes: 10,
      spam: { enabled: true, maxMessages: 6, perSeconds: 5, action: 'timeout' },
      links: { enabled: false, allowedDomains: ['youtube.com', 'youtu.be', 'twitch.tv'], action: 'delete' },
      words: { enabled: false, words: [], action: 'delete' },
      invites: { enabled: true, action: 'delete' },
    },
  },
  logging: {
    enabled: false,
    channelId: null,
    events: {
      messageDelete: true,
      messageEdit: true,
      memberJoin: true,
      memberLeave: true,
      memberRoles: true,
      channels: true,
      bans: true,
      voice: false,
    },
    ignoredChannelIds: [],
  },
  utility: {
    enabled: false,
    commands: { serverinfo: true, userinfo: true, avatar: true, poll: true },
  },
};

/** Settings for one server: any subset of modules (missing ones use defaults). */
export const guildModulesSchema = z
  .object({
    welcome: welcomeConfigSchema.optional(),
    moderation: moderationConfigSchema.optional(),
    logging: loggingConfigSchema.optional(),
    utility: utilityConfigSchema.optional(),
  })
  .strict();
export type GuildModules = z.infer<typeof guildModulesSchema>;

/** All module settings of a bot, keyed by Discord server ID. */
export const botModulesSchema = z.record(snowflakeSchema, guildModulesSchema);
export type BotModules = z.infer<typeof botModulesSchema>;

export function resolveGuildModules(guild: GuildModules | undefined): ModuleConfigs {
  return {
    welcome: guild?.welcome ?? DEFAULT_MODULE_CONFIGS.welcome,
    moderation: guild?.moderation ?? DEFAULT_MODULE_CONFIGS.moderation,
    logging: guild?.logging ?? DEFAULT_MODULE_CONFIGS.logging,
    utility: guild?.utility ?? DEFAULT_MODULE_CONFIGS.utility,
  };
}

// ─── Metadata for the UI and for computing intents / permissions ──────────────────────────────────────────────────

export interface ModuleInfo {
  id: ModuleId;
  name: string;
  summary: string;
  /** Plan feature that unlocks the module. */
  feature: FeatureKey;
  /** Built and usable now; others are listed with their roadmap phase. */
  available: boolean;
  commands: string[];
}

export const MODULES: readonly ModuleInfo[] = [
  { id: 'welcome', name: 'Welcome', summary: 'Greet new members, say goodbye, send a DM and give roles automatically.', feature: 'modules.basic', available: true, commands: [] },
  { id: 'moderation', name: 'Moderation', summary: 'Kick, ban, timeout and warn with staff-only commands, warning thresholds and auto-moderation.', feature: 'modules.basic', available: true, commands: ['/warn', '/warnings', '/clearwarnings', '/timeout', '/untimeout', '/kick', '/ban', '/unban', '/purge'] },
  { id: 'logging', name: 'Logging', summary: 'Record deleted and edited messages, joins, leaves, role, channel, ban and voice changes.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'utility', name: 'Utility', summary: 'Handy commands: server info, user info, avatars and native Discord polls.', feature: 'modules.basic', available: true, commands: ['/serverinfo', '/userinfo', '/avatar', '/poll'] },
  { id: 'leveling', name: 'Leveling', summary: 'XP for chatting, levels, leaderboards and role rewards.', feature: 'modules.standard', available: false, commands: [] },
  { id: 'tickets', name: 'Tickets', summary: 'Support ticket panels with private channels and transcripts.', feature: 'modules.standard', available: false, commands: [] },
  { id: 'verification', name: 'Verification', summary: 'Verification button and role for new members.', feature: 'modules.standard', available: false, commands: [] },
  { id: 'reactionRoles', name: 'Reaction Roles', summary: 'Let members pick roles with buttons and menus.', feature: 'modules.standard', available: false, commands: [] },
  { id: 'suggestions', name: 'Suggestions', summary: 'Members submit ideas, others vote, staff approve or reject.', feature: 'modules.standard', available: false, commands: [] },
  { id: 'giveaways', name: 'Giveaways', summary: 'Timed giveaways with automatic winner selection.', feature: 'modules.standard', available: false, commands: [] },
];

export function moduleInfo(id: ModuleId): ModuleInfo {
  return MODULES.find((m) => m.id === id)!;
}

const I = (...keys: string[]) => keys.reduce((acc, k) => acc | (INTENT_BITS[k] ?? 0), 0);

/** Gateway intents one module needs with the given settings. */
export function moduleIntents(id: ImplementedModuleId, config: ModuleConfigs[ImplementedModuleId]): number {
  if (!config.enabled) return 0;
  switch (id) {
    case 'welcome':
      return I('GuildMembers');
    case 'moderation': {
      const c = config as ModerationConfig;
      return c.automod.enabled ? I('GuildMessages', 'MessageContent') : 0;
    }
    case 'logging': {
      const e = (config as LoggingConfig).events;
      let bits = 0;
      if (e.messageDelete || e.messageEdit) bits |= I('GuildMessages', 'MessageContent');
      if (e.memberJoin || e.memberLeave || e.memberRoles) bits |= I('GuildMembers');
      if (e.bans) bits |= I('GuildModeration');
      if (e.voice) bits |= I('GuildVoiceStates');
      return bits;
    }
    case 'utility':
      return 0;
  }
}

/** Every intent the bot needs for all its servers' settings. */
export function computeIntents(modules: BotModules): number {
  let bits = BASE_INTENTS;
  for (const guild of Object.values(modules)) {
    const resolved = resolveGuildModules(guild);
    for (const id of IMPLEMENTED_MODULES) bits |= moduleIntents(id, resolved[id]);
  }
  return bits;
}

/** Turns off modules (and Pro-only parts) the plan does not include — used at start-up after a downgrade. */
export function applyEntitlementsToModules(modules: BotModules, features: readonly string[]): BotModules {
  const out: BotModules = {};
  for (const [guildId, guild] of Object.entries(modules)) {
    const g: GuildModules = { ...guild };
    for (const id of IMPLEMENTED_MODULES) {
      const cfg = g[id];
      if (cfg?.enabled && !features.includes(moduleInfo(id).feature)) {
        (g as Record<string, unknown>)[id] = { ...cfg, enabled: false };
      }
    }
    if (g.moderation?.automod.enabled && !features.includes('moderation.advanced')) {
      g.moderation = { ...g.moderation, automod: { ...g.moderation.automod, enabled: false } };
    }
    out[guildId] = g;
  }
  return out;
}

// ─── Message templates ────────────────────────────────────────────────────────────────────────────────────────────

export const TEMPLATE_VARIABLES = [
  { key: '{user}', description: 'Mentions the member (@name)' },
  { key: '{user.name}', description: 'Member’s display name' },
  { key: '{user.id}', description: 'Member’s ID' },
  { key: '{server}', description: 'Server name' },
  { key: '{memberCount}', description: 'Number of members' },
] as const;

/** Replaces {variables}; unknown ones are left untouched so typos are visible. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z.]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}

// ─── Auto-moderation checks (pure, so they are easy to test) ──────────────────────────────────────────────────────

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg)\/[\w-]+/i;
const URL_RE = /\bhttps?:\/\/([^\s/<>]+)/gi;

export function containsInvite(text: string): boolean {
  return INVITE_RE.test(text);
}

/** Links whose domain is not on the allow-list (subdomains of allowed domains are allowed). */
export function disallowedLinks(text: string, allowedDomains: readonly string[]): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const host = (m[1] ?? '').toLowerCase().replace(/:\d+$/, '');
    const allowed = allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));
    if (!allowed) found.push(host);
  }
  return found;
}

/** Whole-word, case-insensitive match; also catches simple separators like "b.a.d". */
export function matchBlockedWord(text: string, words: readonly string[]): string | null {
  const lower = text.toLowerCase();
  const squashed = lower.replace(/[\s._\-*]+/g, '');
  for (const w of words) {
    if (!w) continue;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(lower)) return w;
    if (w.length >= 4 && squashed.includes(w)) return w;
  }
  return null;
}

/** Sliding-window spam detector state for one member. Returns true when the limit is exceeded. */
export function recordMessageAndCheckSpam(timestamps: number[], now: number, maxMessages: number, perSeconds: number): boolean {
  const windowStart = now - perSeconds * 1000;
  while (timestamps.length && timestamps[0]! < windowStart) timestamps.shift();
  timestamps.push(now);
  return timestamps.length > maxMessages;
}

/** The strongest threshold action reached at exactly this warning count, if any. */
export function thresholdFor(
  thresholds: ModerationConfig['thresholds'],
  warningCount: number,
): ModerationConfig['thresholds'][number] | null {
  const matches = thresholds.filter((t) => t.warnings === warningCount);
  const rank = { timeout: 0, kick: 1, ban: 2 } as const;
  return matches.sort((a, b) => rank[b.action] - rank[a.action])[0] ?? null;
}

// ─── Server structure (for channel / role pickers) ────────────────────────────────────────────────────────────────

export type GuildChannelKind = 'text' | 'announcement' | 'voice' | 'category' | 'forum' | 'other';

export interface GuildChannelInfo {
  id: string;
  name: string;
  kind: GuildChannelKind;
  parentId: string | null;
  position: number;
}

export interface GuildRoleInfo {
  id: string;
  name: string;
  color: number;
  position: number;
  /** Bot / integration roles cannot be assigned. */
  managed: boolean;
}

export interface GuildInfo {
  id: string;
  name: string;
  iconUrl: string | null;
  channels: GuildChannelInfo[];
  roles: GuildRoleInfo[];
  /** Position of the bot's highest role — it can only assign roles below this. */
  botRolePosition: number;
  /** The bot's server-wide permissions (decimal string). */
  botPermissions: string;
}

export const updateModuleSchema = z
  .object({
    id: z.uuid(),
    guildId: snowflakeSchema,
    moduleId: z.enum(['welcome', 'moderation', 'logging', 'utility']),
    config: z.unknown(),
  })
  .strict();

export interface ModuleUpdateResult {
  modules: BotModules;
  /** True when the change needs new gateway intents, which only take effect after a restart. */
  restartRequired: boolean;
}

/** Permissions each enabled module needs, for "missing permission" warnings. */
export function modulePermissions(id: ImplementedModuleId, config: ModuleConfigs[ImplementedModuleId]): bigint {
  if (!config.enabled) return 0n;
  const P = (n: bigint) => 1n << n;
  const VIEW = P(10n), SEND = P(11n), EMBED = P(14n), HISTORY = P(16n);
  switch (id) {
    case 'welcome': {
      const c = config as WelcomeConfig;
      return VIEW | SEND | EMBED | (c.autoRoles.roleIds.length ? P(28n) : 0n);
    }
    case 'moderation': {
      const c = config as ModerationConfig;
      return VIEW | SEND | EMBED | HISTORY | P(1n) | P(2n) | P(40n) | P(13n) | (c.automod.enabled ? P(13n) : 0n);
    }
    case 'logging':
      return VIEW | SEND | EMBED | P(7n);
    case 'utility':
      return VIEW | SEND | EMBED;
  }
}
