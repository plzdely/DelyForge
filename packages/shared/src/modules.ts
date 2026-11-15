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
            allowedDomains: z.array(z.string().trim().toLowerCase().min(1).max(100)).max(50),
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

// ─── Panels (a message with a button that the bot posts and keeps up to date) ─────────────────────────────────────

export const panelSchema = z
  .object({
    /** Where the bot posts the panel. Changing it moves the panel. */
    channelId: channel,
    title: z.string().trim().min(1, 'Give the panel a title').max(256),
    description: template(2000),
    buttonLabel: z.string().trim().min(1, 'Give the button a label').max(80),
    color: hexColor,
  })
  .strict();
export type PanelConfig = z.infer<typeof panelSchema>;

// ─── Leveling ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const levelingConfigSchema = z
  .object({
    enabled: z.boolean(),
    xpMin: z.number().int().min(1).max(100),
    xpMax: z.number().int().min(1).max(200),
    /** A member earns XP at most once per this many seconds (stops spam farming). */
    cooldownSeconds: z.number().int().min(0).max(3600),
    levelUp: z
      .object({
        enabled: z.boolean(),
        /** null = announce in the channel where the member leveled up. */
        channelId: channel,
        message: template(1000),
      })
      .strict(),
    rewards: z.array(z.object({ level: z.number().int().min(1).max(500), roleId: snowflakeSchema }).strict()).max(25),
    /** Keep earlier reward roles when a higher one is earned. */
    stackRewards: z.boolean(),
    noXpChannelIds: z.array(snowflakeSchema).max(50),
    noXpRoleIds: roles,
  })
  .strict()
  .refine((c) => c.xpMin <= c.xpMax, { message: 'Minimum XP must not be higher than maximum XP', path: ['xpMin'] });
export type LevelingConfig = z.infer<typeof levelingConfigSchema>;

// ─── Tickets ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const ticketsConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** Category new ticket channels are created in (null = no category). */
    categoryId: channel,
    /** Roles that can see and answer every ticket. */
    staffRoleIds: roles,
    panel: panelSchema,
    openMessage: template(2000),
    maxOpenPerUser: z.number().int().min(1).max(10),
    /** Where transcripts of closed tickets are posted (null = don't keep transcripts). */
    transcriptChannelId: channel,
    /** Also DM the transcript to the member who opened the ticket. */
    dmTranscript: z.boolean(),
  })
  .strict();
export type TicketsConfig = z.infer<typeof ticketsConfigSchema>;

// ─── Verification ─────────────────────────────────────────────────────────────────────────────────────────────────

export const verificationConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** Role given when a member verifies. */
    roleId: snowflakeSchema.nullable(),
    /** Optional role taken away when verifying (e.g. "Unverified"). */
    removeRoleId: snowflakeSchema.nullable(),
    panel: panelSchema,
    /** Refuse accounts younger than this (0 = off). Stops many throwaway raid accounts. */
    minAccountAgeDays: z.number().int().min(0).max(365),
  })
  .strict();
export type VerificationConfig = z.infer<typeof verificationConfigSchema>;

// ─── Reaction roles ───────────────────────────────────────────────────────────────────────────────────────────────

export const roleOptionSchema = z
  .object({
    roleId: snowflakeSchema,
    label: z.string().trim().min(1, 'Every role needs a label').max(80),
    /** A unicode emoji, e.g. 🎮 (optional). */
    emoji: z.string().max(16),
  })
  .strict();

export const rolePanelSchema = z
  .object({
    /** Stable ID so the bot can find and update the panel it posted. */
    id: z.string().regex(/^[a-z0-9]{1,12}$/),
    channelId: channel,
    title: z.string().trim().min(1, 'Give the panel a title').max(256),
    description: template(2000),
    color: hexColor,
    mode: z.enum(['buttons', 'menu']),
    /** Menu mode: allow picking several roles from this panel. Buttons always toggle independently. */
    multiple: z.boolean(),
    roles: z.array(roleOptionSchema).min(1, 'Add at least one role').max(25),
  })
  .strict();
export type RolePanelConfig = z.infer<typeof rolePanelSchema>;

export const reactionRolesConfigSchema = z
  .object({
    enabled: z.boolean(),
    panels: z
      .array(rolePanelSchema)
      .max(10)
      .refine((p) => new Set(p.map((x) => x.id)).size === p.length, 'Panel IDs must be unique'),
  })
  .strict();
export type ReactionRolesConfig = z.infer<typeof reactionRolesConfigSchema>;

// ─── Suggestions ──────────────────────────────────────────────────────────────────────────────────────────────────

export const suggestionsConfigSchema = z
  .object({
    enabled: z.boolean(),
    channelId: channel,
    /** Who may approve or reject (anyone with Manage Server can too). */
    staffRoleIds: roles,
  })
  .strict();
export type SuggestionsConfig = z.infer<typeof suggestionsConfigSchema>;

// ─── Giveaways ────────────────────────────────────────────────────────────────────────────────────────────────────

export const giveawaysConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** Who may start, end and reroll giveaways (anyone with Manage Server can too). */
    managerRoleIds: roles,
    color: hexColor,
  })
  .strict();
export type GiveawaysConfig = z.infer<typeof giveawaysConfigSchema>;

// ─── Registry — the one list of built modules; everything below is derived from it ────────────────────────────────

export const moduleConfigSchemas = {
  welcome: welcomeConfigSchema,
  moderation: moderationConfigSchema,
  logging: loggingConfigSchema,
  utility: utilityConfigSchema,
  leveling: levelingConfigSchema,
  tickets: ticketsConfigSchema,
  verification: verificationConfigSchema,
  reactionRoles: reactionRolesConfigSchema,
  suggestions: suggestionsConfigSchema,
  giveaways: giveawaysConfigSchema,
} as const;
export type ImplementedModuleId = keyof typeof moduleConfigSchemas;
export const IMPLEMENTED_MODULES = Object.keys(moduleConfigSchemas) as [ImplementedModuleId, ...ImplementedModuleId[]];

export function isImplementedModule(id: string): id is ImplementedModuleId {
  return Object.prototype.hasOwnProperty.call(moduleConfigSchemas, id);
}

export type ModuleConfigs = { [K in ImplementedModuleId]: z.infer<(typeof moduleConfigSchemas)[K]> };

const panel = (title: string, description: string, buttonLabel: string, color: string): PanelConfig => ({
  channelId: null,
  title,
  description,
  buttonLabel,
  color,
});

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
  leveling: {
    enabled: false,
    xpMin: 15,
    xpMax: 25,
    cooldownSeconds: 60,
    levelUp: { enabled: true, channelId: null, message: '🎉 {user} reached **level {level}**!' },
    rewards: [],
    stackRewards: true,
    noXpChannelIds: [],
    noXpRoleIds: [],
  },
  tickets: {
    enabled: false,
    categoryId: null,
    staffRoleIds: [],
    panel: panel('Need help?', 'Click the button below to open a private ticket with our staff.', 'Open a ticket', '#7c5cff'),
    openMessage: 'Hi {user}, thanks for reaching out! Describe your issue and a staff member will be with you shortly.',
    maxOpenPerUser: 1,
    transcriptChannelId: null,
    dmTranscript: true,
  },
  verification: {
    enabled: false,
    roleId: null,
    removeRoleId: null,
    panel: panel('Verify to get access', 'Click the button below to unlock the rest of the server.', 'Verify', '#3dd68c'),
    minAccountAgeDays: 0,
  },
  reactionRoles: { enabled: false, panels: [] },
  suggestions: { enabled: false, channelId: null, staffRoleIds: [] },
  giveaways: { enabled: false, managerRoleIds: [], color: '#f5a524' },
};

/** Settings for one server: any subset of modules (missing ones use defaults). */
export const guildModulesSchema = z
  .object(
    Object.fromEntries(IMPLEMENTED_MODULES.map((id) => [id, moduleConfigSchemas[id].optional()])) as {
      [K in ImplementedModuleId]: z.ZodOptional<(typeof moduleConfigSchemas)[K]>;
    },
  )
  .strict();
export type GuildModules = z.infer<typeof guildModulesSchema>;

/** All module settings of a bot, keyed by Discord server ID. */
export const botModulesSchema = z.record(snowflakeSchema, guildModulesSchema);
export type BotModules = z.infer<typeof botModulesSchema>;

export function resolveGuildModules(guild: GuildModules | undefined): ModuleConfigs {
  return Object.fromEntries(IMPLEMENTED_MODULES.map((id) => [id, guild?.[id] ?? DEFAULT_MODULE_CONFIGS[id]])) as ModuleConfigs;
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
  { id: 'leveling', name: 'Leveling', summary: 'XP for chatting, levels, leaderboards and role rewards.', feature: 'modules.standard', available: true, commands: ['/rank', '/leaderboard'] },
  { id: 'tickets', name: 'Tickets', summary: 'A support panel that opens private ticket channels, with transcripts when closed.', feature: 'modules.standard', available: true, commands: ['/ticket add', '/ticket close'] },
  { id: 'verification', name: 'Verification', summary: 'A verify button that gives new members access, with an optional minimum account age.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'reactionRoles', name: 'Reaction Roles', summary: 'Panels where members pick their own roles with buttons or a menu.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'suggestions', name: 'Suggestions', summary: 'Members submit ideas, others vote, staff approve or reject.', feature: 'modules.standard', available: true, commands: ['/suggest'] },
  { id: 'giveaways', name: 'Giveaways', summary: 'Timed giveaways with a join button and automatic, fair winner picking.', feature: 'modules.standard', available: true, commands: ['/giveaway start', '/giveaway end', '/giveaway reroll'] },
];

export function moduleInfo(id: ModuleId): ModuleInfo {
  return MODULES.find((m) => m.id === id)!;
}

const I = (...keys: string[]) => keys.reduce((acc, k) => acc | (INTENT_BITS[k] ?? 0), 0);

/** Gateway intents one module needs with the given settings. */
export function moduleIntents<K extends ImplementedModuleId>(id: K, config: ModuleConfigs[K]): number {
  if (!config.enabled) return 0;
  switch (id) {
    case 'welcome':
      return I('GuildMembers');
    case 'moderation':
      return (config as ModerationConfig).automod.enabled ? I('GuildMessages', 'MessageContent') : 0;
    case 'logging': {
      const e = (config as LoggingConfig).events;
      let bits = 0;
      if (e.messageDelete || e.messageEdit) bits |= I('GuildMessages', 'MessageContent');
      if (e.memberJoin || e.memberLeave || e.memberRoles) bits |= I('GuildMembers');
      if (e.bans) bits |= I('GuildModeration');
      if (e.voice) bits |= I('GuildVoiceStates');
      return bits;
    }
    case 'leveling':
      return I('GuildMessages'); // message events arrive without the privileged content intent
    default:
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

// ─── Leveling maths (same curve players know from popular leveling bots) ──────────────────────────────────────────

/** XP needed to go from `level` to `level + 1`. */
export function xpToNextLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

/** Level and progress for a total amount of XP. */
export function levelFromXp(totalXp: number): { level: number; current: number; needed: number } {
  let level = 0;
  let rest = Math.max(0, Math.floor(totalXp));
  while (rest >= xpToNextLevel(level)) {
    rest -= xpToNextLevel(level);
    level++;
  }
  return { level, current: rest, needed: xpToNextLevel(level) };
}

// ─── Auto-moderation checks (pure, so they are easy to test) ──────────────────────────────────────────────────────

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg)\/[\w-]+/i;
const URL_RE = /\bhttps?:\/\/[^\s<>]+/gi;

export function containsInvite(text: string): boolean {
  return INVITE_RE.test(text);
}

/**
 * Links whose website is not on the allow-list (subdomains of allowed sites are allowed). The real hostname comes from
 * the URL parser, so tricks like `https://evil.com?x.youtube.com` or `https://youtube.com@evil.com` don't slip through.
 */
export function disallowedLinks(text: string, allowedDomains: readonly string[]): string[] {
  const found: string[] = [];
  for (const [raw] of text.matchAll(URL_RE)) {
    let host: string;
    try {
      host = new URL(raw).hostname.toLowerCase().replace(/\.$/, '');
    } catch {
      found.push(raw);
      continue;
    }
    const allowed = allowedDomains.some((d) => d && (host === d || host.endsWith(`.${d}`)));
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
    moduleId: z.enum(IMPLEMENTED_MODULES),
    config: z.unknown(),
  })
  .strict();

export interface ModuleUpdateResult {
  modules: BotModules;
  /** True when the change needs new gateway intents, which only take effect after a restart. */
  restartRequired: boolean;
}

/** Permissions each enabled module needs, for "missing permission" warnings. */
export function modulePermissions<K extends ImplementedModuleId>(id: K, config: ModuleConfigs[K]): bigint {
  if (!config.enabled) return 0n;
  const P = (n: bigint) => 1n << n;
  const VIEW = P(10n), SEND = P(11n), EMBED = P(14n), HISTORY = P(16n), ROLES = P(28n);
  const base = VIEW | SEND | EMBED;
  switch (id) {
    case 'welcome':
      return base | ((config as WelcomeConfig).autoRoles.roleIds.length ? ROLES : 0n);
    case 'moderation':
      return base | HISTORY | P(1n) | P(2n) | P(40n) | P(13n);
    case 'logging':
      return base | P(7n);
    case 'leveling':
      return base | ((config as LevelingConfig).rewards.length ? ROLES : 0n);
    case 'tickets':
      return base | HISTORY | ROLES | P(4n) | P(15n); // manage channels + attach transcripts
    case 'verification':
    case 'reactionRoles':
      return base | ROLES;
    case 'giveaways':
      return base | HISTORY;
    default:
      return base;
  }
}
