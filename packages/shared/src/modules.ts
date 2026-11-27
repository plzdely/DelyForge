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
  'invites',
  'starboard',
  'tempVoice',
  'antiRaid',
  'sticky',
  'serverStats',
  'birthdays',
  'feeds',
  'scheduled',
  'shop',
  'modmail',
  'applications',
  'economy',
  'games',
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

// ─── Building blocks ──────────────────────────────────────────────────────────────────────────────────────────────

const channel = snowflakeSchema.nullable();
const roles = z.array(snowflakeSchema).max(25);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7c5cff');
const template = (max = 2000) => z.string().max(max, `At most ${max} characters`);
/** An https:// image or page link, or '' for none. */
const optionalHttps = z.union([z.literal(''), z.url({ protocol: /^https$/, message: 'Use a full https:// link' }).max(2048)]);
/** A button that opens a web page (e.g. "Read the rules"). */
const linkButton = z.object({ label: z.string().trim().min(1, 'Give the button a label').max(80), url: z.url({ protocol: /^https$/, message: 'Use a full https:// link' }).max(2048) }).strict();
export type LinkButton = z.infer<typeof linkButton>;

export const messageStyleSchema = z
  .object({
    /** Send as a rich embed instead of plain text. */
    embed: z.boolean(),
    color: hexColor,
    title: z.string().max(256),
    /** Big picture under the card (e.g. a banner). */
    imageUrl: optionalHttps.default(''),
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
        /** Up to 3 link buttons under the welcome message (e.g. Rules, Website). */
        buttons: z.array(linkButton).max(3).default([]),
        /** More versions of the message; each join gets one of them (or the main one) at random. */
        extraMessages: z.array(template().refine((t) => t.trim() !== '', 'Write the message')).max(10).default([]),
        /** Delete the welcome message after this many seconds (0 = keep it). */
        deleteAfterSeconds: z.number().int().min(0).max(3600).default(0),
      })
      .strict(),
    dm: z.object({ enabled: z.boolean(), message: template() }).strict(),
    goodbye: z
      .object({
        enabled: z.boolean(),
        channelId: channel,
        message: template(),
        /** Show as a card with the member's avatar. */
        embed: z.boolean().default(false),
        color: hexColor.default('#f04d5e'),
      })
      .strict(),
    autoRoles: z
      .object({
        roleIds: roles,
        /** Roles for bots that join (instead of the member roles). */
        botRoleIds: roles.default([]),
        /** Wait this long before giving roles (0 = straight away). Helps with raids and Discord's rules screening. */
        delayMinutes: z.number().int().min(0).max(60).default(0),
      })
      .strict(),
    /** Channels where new members are pinged once (the ping is deleted after a few seconds) so they notice them. */
    pingChannelIds: z.array(snowflakeSchema).max(5).default([]),
    /** A thank-you message when someone boosts the server. */
    boost: z
      .object({ enabled: z.boolean(), channelId: channel, message: template(1000) })
      .strict()
      .default({ enabled: false, channelId: null, message: '💜 {user} just boosted the server — thank you! We now have {boosts} boosts.' }),
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
    /** Warnings stop counting after this many days (0 = they never expire). */
    warnExpiryDays: z.number().int().min(0).max(365).default(0),
    /** Added to ban DMs, e.g. how to appeal (empty = nothing). */
    appealMessage: template(500).default(''),
    /** Remove symbols like "!" from the start of nicknames, so nobody hoists themselves to the top of the member list. */
    dehoist: z.boolean().default(false),
    automod: z
      .object({
        /** Pro feature (`moderation.advanced`). */
        enabled: z.boolean(),
        exemptRoleIds: roles,
        /** Channels auto-moderation leaves alone (e.g. a memes channel). */
        exemptChannelIds: z.array(snowflakeSchema).max(50).default([]),
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
        // Added in 0.3 — each has a default so settings saved earlier still load.
        caps: z
          .object({ enabled: z.boolean(), minLength: z.number().int().min(5).max(200), percent: z.number().int().min(50).max(100), action: z.enum(ACTIONS) })
          .strict()
          .default({ enabled: false, minLength: 10, percent: 70, action: 'delete' }),
        mentions: z
          .object({ enabled: z.boolean(), max: z.number().int().min(2).max(50), action: z.enum(ACTIONS) })
          .strict()
          .default({ enabled: true, max: 5, action: 'timeout' }),
        emoji: z
          .object({ enabled: z.boolean(), max: z.number().int().min(3).max(100), action: z.enum(ACTIONS) })
          .strict()
          .default({ enabled: false, max: 10, action: 'delete' }),
        scams: z.object({ enabled: z.boolean(), action: z.enum(ACTIONS) }).strict().default({ enabled: true, action: 'delete' }),
        repeats: z
          .object({ enabled: z.boolean(), count: z.number().int().min(2).max(10), action: z.enum(ACTIONS) })
          .strict()
          .default({ enabled: false, count: 3, action: 'warn' }),
        // Added in 0.5.
        zalgo: z.object({ enabled: z.boolean(), action: z.enum(ACTIONS) }).strict().default({ enabled: false, action: 'delete' }),
        lines: z
          .object({ enabled: z.boolean(), max: z.number().int().min(3).max(100), action: z.enum(ACTIONS) })
          .strict()
          .default({ enabled: false, max: 15, action: 'delete' }),
        /** Members who joined less than `hours` ago can't post links (the usual scam-bot pattern). */
        newMemberLinks: z
          .object({ enabled: z.boolean(), hours: z.number().int().min(1).max(720), action: z.enum(ACTIONS) })
          .strict()
          .default({ enabled: false, hours: 24, action: 'delete' }),
      })
      .strict(),
  })
  .strict();
export type ModerationConfig = z.infer<typeof moderationConfigSchema>;

// ─── Logging ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const LOG_EVENTS = [
  'messageDelete',
  'messageEdit',
  'memberJoin',
  'memberLeave',
  'memberRoles',
  'members',
  'bans',
  'channels',
  'roles',
  'server',
  'invites',
  'messageActions',
  'voice',
  'other',
] as const;
export type LogEvent = (typeof LOG_EVENTS)[number];

/** Logged from Discord's audit log, which says who did it (needs the View Audit Log permission). */
export const AUDIT_LOG_EVENTS: readonly LogEvent[] = ['messageDelete', 'memberRoles', 'members', 'bans', 'channels', 'roles', 'server', 'invites', 'messageActions', 'other'];

/** Default on/off per event. Every key has a default so settings saved before an event existed still load. */
const LOG_EVENT_DEFAULTS: Record<LogEvent, boolean> = Object.fromEntries(LOG_EVENTS.map((e) => [e, e !== 'voice'])) as Record<LogEvent, boolean>;

export const loggingConfigSchema = z
  .object({
    enabled: z.boolean(),
    channelId: channel,
    events: z.object(Object.fromEntries(LOG_EVENTS.map((e) => [e, z.boolean().default(LOG_EVENT_DEFAULTS[e])])) as Record<LogEvent, z.ZodDefault<z.ZodBoolean>>).strict(),
    /** Optional: send some events to their own channel instead of the main one. */
    channelOverrides: z.partialRecord(z.enum(LOG_EVENTS), snowflakeSchema).default({}),
    ignoredChannelIds: z.array(snowflakeSchema).max(50),
    /** Message logs skip members with these roles (e.g. staff or a music bot's role). */
    ignoredRoleIds: roles.default([]),
  })
  .strict();
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;

// ─── Utility ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const utilityConfigSchema = z
  .object({
    enabled: z.boolean(),
    commands: z
      .object({
        serverinfo: z.boolean(),
        userinfo: z.boolean(),
        avatar: z.boolean(),
        poll: z.boolean(),
        /** /remind in:2h text:… — the bot reminds the member later. */
        remind: z.boolean().default(true),
        /** /roll — dice. */
        roll: z.boolean().default(true),
        // Added in 0.5.
        afk: z.boolean().default(true),
        roleinfo: z.boolean().default(true),
        channelinfo: z.boolean().default(true),
        membercount: z.boolean().default(true),
        choose: z.boolean().default(true),
        emoji: z.boolean().default(true),
        timestamp: z.boolean().default(true),
        banner: z.boolean().default(true),
      })
      .strict(),
    /** After someone bumps the server with DISBOARD, remind them in 2 hours to bump again. */
    bumpReminder: z.object({ enabled: z.boolean(), roleId: snowflakeSchema.nullable() }).strict().default({ enabled: false, roleId: null }),
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
        /** Send the level-up message as a DM instead. */
        dm: z.boolean().default(false),
      })
      .strict(),
    rewards: z.array(z.object({ level: z.number().int().min(1).max(500), roleId: snowflakeSchema }).strict()).max(25),
    /** Keep earlier reward roles when a higher one is earned. */
    stackRewards: z.boolean(),
    noXpChannelIds: z.array(snowflakeSchema).max(50),
    noXpRoleIds: roles,
    /** Members with these roles earn more XP (the biggest boost counts), e.g. 1.5× for boosters. */
    multipliers: z.array(z.object({ roleId: snowflakeSchema, multiplier: z.number().min(1).max(5) }).strict()).max(10).default([]),
    /** XP per minute for talking in voice with at least one other person (0 = off). */
    voiceXpPerMinute: z.number().int().min(0).max(50).default(0),
    /** Delete a member's XP when they leave the server. */
    resetOnLeave: z.boolean().default(false),
    /** Double XP on Saturdays and Sundays (UTC). */
    weekendDoubleXp: z.boolean().default(false),
    /** Only announce every Nth level (1 = every level). Reward roles are still given every time. */
    announceEvery: z.number().int().min(1).max(100).default(1),
    /** Channels that give more XP, e.g. 2× in #events. */
    channelMultipliers: z.array(z.object({ channelId: snowflakeSchema, multiplier: z.number().min(1).max(5) }).strict()).max(10).default([]),
  })
  .strict()
  .refine((c) => c.xpMin <= c.xpMax, { message: 'Minimum XP must not be higher than maximum XP', path: ['xpMin'] });
export type LevelingConfig = z.infer<typeof levelingConfigSchema>;

// ─── Tickets ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** An extra ticket panel with its own button, category, staff and first message (e.g. "Report a member"). */
export const ticketPanelSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]{1,12}$/),
    /** Short name, also used in the ticket channel's name (e.g. "report" → #report-12-dely). */
    name: z.string().trim().min(1, 'Give the panel a name').max(40),
    panel: panelSchema,
    /** null = the main ticket category. */
    categoryId: channel,
    /** Staff for this kind of ticket (the main staff roles can always see every ticket). */
    staffRoleIds: roles,
    openMessage: template(2000),
    /** Ping the staff roles when a ticket opens. */
    pingStaff: z.boolean().default(true),
  })
  .strict();
export type TicketPanelConfig = z.infer<typeof ticketPanelSchema>;

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
    /** Ask "What do you need help with?" in a pop-up before opening. */
    askReason: z.boolean().default(false),
    /** Show a Claim button so a staff member can take the ticket. */
    claimButton: z.boolean().default(true),
    /** Close tickets with no new messages for this many hours (0 = never). A transcript is saved as usual. */
    autoCloseHours: z.number().int().min(0).max(336).default(0),
    /** Ping the staff roles when a ticket opens from the main panel. */
    pingStaff: z.boolean().default(true),
    /** Where ticket events (opened, claimed, closed, ratings) are posted (null = nowhere). */
    logChannelId: snowflakeSchema.nullable().default(null),
    /** After closing, DM the member a 1–5 star rating; ratings go to the ticket log. */
    feedback: z.boolean().default(false),
    /** More panels, each opening its own kind of ticket. */
    extraPanels: z
      .array(ticketPanelSchema)
      .max(5)
      .refine((p) => new Set(p.map((x) => x.id)).size === p.length, 'Panel IDs must be unique')
      .default([]),
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
    /** Where every verify attempt is logged (who, account age, result). Default keeps older settings valid. */
    logChannelId: snowflakeSchema.nullable().default(null),
    /** "math": members answer a small sum in a pop-up before they're verified (stops simple bots). */
    challenge: z.enum(['none', 'math']).default('none'),
    /** Kick members who haven't verified after this many hours (0 = never). */
    kickAfterHours: z.number().int().min(0).max(168).default(0),
    /** DM sent after verifying (empty = none). */
    dmMessage: template(1000).default(''),
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
    /** Menu mode: allow picking several roles from this panel. */
    multiple: z.boolean(),
    /** Buttons mode: a member can have only one role from this panel — clicking another swaps it. */
    oneRoleOnly: z.boolean().default(false),
    roles: z.array(roleOptionSchema).min(1, 'Add at least one role').max(25),
    /** Only members with this role can use the panel (null = everyone). */
    requiredRoleId: snowflakeSchema.nullable().default(null),
    /** Most roles a member can have from this panel (0 = no limit). */
    maxRoles: z.number().int().min(0).max(25).default(0),
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
    /** Open a discussion thread on every suggestion. */
    threads: z.boolean().default(false),
    /** Hide who made the suggestion (staff can still see it in the bot's data). */
    anonymous: z.boolean().default(false),
    /** DM the author when their suggestion is approved or rejected. */
    dmOnDecision: z.boolean().default(true),
    /** Minutes a member must wait between suggestions (0 = no wait). */
    cooldownMinutes: z.number().int().min(0).max(1440).default(0),
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
    /** Members with these roles get extra entries (the biggest bonus counts), e.g. boosters ×2. */
    bonusRoles: z.array(z.object({ roleId: snowflakeSchema, entries: z.number().int().min(2).max(10) }).strict()).max(5).default([]),
    /** Accounts younger than this can't enter (0 = anyone). Stops alt accounts farming giveaways. */
    minAccountAgeDays: z.number().int().min(0).max(365).default(0),
    /** Members must have been in the server this many days to enter (0 = anyone). */
    minMemberDays: z.number().int().min(0).max(365).default(0),
    /** DM the winners. */
    dmWinners: z.boolean().default(true),
  })
  .strict();
export type GiveawaysConfig = z.infer<typeof giveawaysConfigSchema>;

// ─── Invite tracker ───────────────────────────────────────────────────────────────────────────────────────────────

export const invitesConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** Where to announce who invited each new member (null = only in logs and /invites). */
    channelId: channel,
    message: template(500),
    /** Roles given to members who bring in enough people (counted: invited members still in the server). */
    rewards: z.array(z.object({ invites: z.number().int().min(1).max(1000), roleId: snowflakeSchema }).strict()).max(10).default([]),
  })
  .strict();
export type InvitesConfig = z.infer<typeof invitesConfigSchema>;
export const INVITE_VARIABLES = [
  { key: '{user}', description: 'Mentions the new member' },
  { key: '{inviter}', description: 'Mentions who invited them' },
  { key: '{invites}', description: 'How many members the inviter has brought in' },
  { key: '{code}', description: 'The invite code used' },
] as const;

// ─── Starboard ────────────────────────────────────────────────────────────────────────────────────────────────────

export const starboardConfigSchema = z
  .object({
    enabled: z.boolean(),
    channelId: channel,
    /** A normal emoji (⭐) or a server emoji written as <:name:id>. */
    emoji: z.string().trim().min(1, 'Choose an emoji').max(64),
    threshold: z.number().int().min(1).max(100),
    /** Whether the author's own reaction counts. */
    selfStar: z.boolean(),
    ignoredChannelIds: z.array(snowflakeSchema).max(50),
  })
  .strict();
export type StarboardConfig = z.infer<typeof starboardConfigSchema>;

// ─── Temporary voice channels ─────────────────────────────────────────────────────────────────────────────────────

export const tempVoiceConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** Joining this voice channel creates a new one for the member. */
    hubChannelId: channel,
    /** Category for new channels (null = the hub's category). */
    categoryId: channel,
    nameTemplate: z.string().trim().min(1, 'Give the channels a name').max(90),
    /** 0 = no limit. */
    userLimit: z.number().int().min(0).max(99),
    /** Owners can use /voice lock, unlock, limit, rename and claim. */
    ownerCommands: z.boolean().default(true),
    /** More "join to create" channels, each with its own name and limit (e.g. Duo = 2, Squad = 4). */
    extraHubs: z
      .array(
        z
          .object({
            hubChannelId: snowflakeSchema,
            nameTemplate: z.string().trim().min(1, 'Give the channels a name').max(90),
            userLimit: z.number().int().min(0).max(99),
          })
          .strict(),
      )
      .max(5)
      .default([]),
  })
  .strict();
export type TempVoiceConfig = z.infer<typeof tempVoiceConfigSchema>;

// ─── Raid protection ──────────────────────────────────────────────────────────────────────────────────────────────

export const antiRaidConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** Where to alert staff about raids and removed accounts. */
    alertChannelId: channel,
    /** A raid is this many joins within `perSeconds`. */
    joinThreshold: z.number().int().min(3).max(100),
    perSeconds: z.number().int().min(5).max(600),
    /** What happens to everyone who joins while a raid is going on. */
    raidAction: z.enum(['alert', 'kick', 'ban']),
    raidMinutes: z.number().int().min(1).max(120),
    /** Accounts younger than this are always removed (0 = off). */
    minAccountAgeDays: z.number().int().min(0).max(90),
    /** During a raid, raise the server's verification level to High; it's put back when the raid is over. */
    lockdown: z.boolean().default(false),
    /** During a raid, pause the server's invite links (Discord's "Pause invites"). */
    pauseInvites: z.boolean().default(false),
    /** Anti-nuke: someone deleting channels or roles, or banning/kicking many members, in a short time is stopped. */
    antiNuke: z
      .object({
        enabled: z.boolean(),
        /** This many destructive actions … */
        maxActions: z.number().int().min(2).max(50),
        /** … within this many seconds. */
        perSeconds: z.number().int().min(10).max(600),
        /** "strip": take all their roles away; "ban": ban them. */
        action: z.enum(['strip', 'ban']),
        /** People anti-nuke never acts on (the server owner is always trusted). */
        trustedUserIds: z.array(snowflakeSchema).max(25),
      })
      .strict()
      .default({ enabled: false, maxActions: 5, perSeconds: 60, action: 'strip', trustedUserIds: [] }),
  })
  .strict();
export type AntiRaidConfig = z.infer<typeof antiRaidConfigSchema>;

// ─── Sticky messages ──────────────────────────────────────────────────────────────────────────────────────────────

export const stickyConfigSchema = z
  .object({
    enabled: z.boolean(),
    messages: z
      .array(
        z
          .object({
            channelId: snowflakeSchema,
            text: z.string().trim().min(1, 'Write the sticky message').max(2000),
            /** Show it as a coloured card. */
            embed: z.boolean().default(false),
            color: hexColor.default('#7c5cff'),
          })
          .strict(),
      )
      .max(10)
      .refine((m) => new Set(m.map((x) => x.channelId)).size === m.length, 'One sticky message per channel'),
    /** How long a channel must be quiet before the sticky message is re-posted. */
    quietSeconds: z.number().int().min(2).max(120).default(5),
  })
  .strict();
export type StickyConfig = z.infer<typeof stickyConfigSchema>;

// ─── Server stats counters ────────────────────────────────────────────────────────────────────────────────────────

export const STAT_VARIABLES = [
  { key: '{members}', description: 'Everyone in the server' },
  { key: '{humans}', description: 'Members who aren’t bots' },
  { key: '{bots}', description: 'Bots' },
  { key: '{boosts}', description: 'Server boosts' },
  { key: '{channels}', description: 'Channels' },
  { key: '{roles}', description: 'Roles' },
  { key: '{textChannels}', description: 'Text channels' },
  { key: '{voiceChannels}', description: 'Voice channels' },
  { key: '{emojis}', description: 'Server emojis' },
  { key: '{boostTier}', description: 'Boost level (0–3)' },
] as const;

export const serverStatsConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** Channels (usually locked voice channels) whose name shows a live number. */
    counters: z
      .array(z.object({ channelId: snowflakeSchema, template: z.string().trim().min(1, 'Write the channel name').max(90) }).strict())
      .max(5)
      .refine((c) => new Set(c.map((x) => x.channelId)).size === c.length, 'One counter per channel'),
  })
  .strict();
export type ServerStatsConfig = z.infer<typeof serverStatsConfigSchema>;

// ─── Birthdays ────────────────────────────────────────────────────────────────────────────────────────────────────

export const birthdaysConfigSchema = z
  .object({
    enabled: z.boolean(),
    channelId: channel,
    message: template(500),
    /** Given for the day of someone's birthday (null = no role). */
    roleId: snowflakeSchema.nullable(),
    /** Hour of the day (UTC) to announce birthdays. */
    hourUtc: z.number().int().min(0).max(23),
    /** Also DM the birthday person (empty = no DM). */
    dmMessage: template(500).default(''),
  })
  .strict();
export type BirthdaysConfig = z.infer<typeof birthdaysConfigSchema>;

// ─── Social alerts (YouTube and news feeds) ───────────────────────────────────────────────────────────────────────

export const FEED_VARIABLES = [
  { key: '{title}', description: 'Title of the new video or post' },
  { key: '{link}', description: 'Link to it' },
  { key: '{author}', description: 'Channel or site name' },
  { key: '{role}', description: 'Pings the chosen role' },
] as const;

export const feedsConfigSchema = z
  .object({
    enabled: z.boolean(),
    feeds: z
      .array(
        z
          .object({
            kind: z.enum(['youtube', 'rss']),
            /** YouTube: a channel link (youtube.com/@name or /channel/UC…) or channel ID. RSS: the feed's https:// address. */
            source: z.string().trim().min(2, 'Add the channel or feed address').max(300),
            channelId: snowflakeSchema,
            message: template(500),
            /** Role to ping with {role} (null = no ping). */
            roleId: snowflakeSchema.nullable(),
            /** Only post when the title contains one of these words (comma-separated; empty = everything). */
            keywords: z.string().max(200).default(''),
            /** YouTube: don't announce Shorts. */
            skipShorts: z.boolean().default(false),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type FeedsConfig = z.infer<typeof feedsConfigSchema>;

// ─── Scheduled messages ───────────────────────────────────────────────────────────────────────────────────────────

export const scheduledConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** IANA time zone the times are in, e.g. "America/Chicago" (the app fills in yours). */
    timezone: z.string().trim().min(1).max(64),
    messages: z
      .array(
        z
          .object({
            channelId: snowflakeSchema,
            text: z.string().trim().min(1, 'Write the message').max(2000),
            /** 0 = Sunday … 6 = Saturday. Empty = every day. */
            days: z.array(z.number().int().min(0).max(6)).max(7),
            time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30'),
            roleId: snowflakeSchema.nullable(),
            /** Post as a coloured card. */
            embed: z.boolean().default(false),
            color: hexColor.default('#7c5cff'),
            /** Delete the previous post of this message when posting a new one (keeps the channel tidy). */
            deletePrevious: z.boolean().default(false),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();
export type ScheduledConfig = z.infer<typeof scheduledConfigSchema>;

// ─── Shop (price list, sales, orders) ──────────────────────────────────────────────────────────────────────────────

const shopId = z.string().regex(/^[a-z0-9]{1,12}$/);
const money = z.number().min(0, 'Prices can’t be negative').max(1_000_000);

export const shopItemSchema = z
  .object({
    id: shopId,
    name: z.string().trim().min(1, 'Name the item').max(80),
    price: money,
    /** Top of a price range ("$30-$50"), or null for one price. */
    priceTo: money.nullable(),
    /** "and up" ("$20+"): the final price depends on the work. */
    plus: z.boolean(),
  })
  .strict();
export type ShopItem = z.infer<typeof shopItemSchema>;

export const shopCategorySchema = z
  .object({
    id: shopId,
    emoji: z.string().trim().max(64),
    name: z.string().trim().min(1, 'Name the category').max(60),
    items: z.array(shopItemSchema).max(25),
  })
  .strict();
export type ShopCategory = z.infer<typeof shopCategorySchema>;

export const shopSaleSchema = z
  .object({
    id: shopId,
    name: z.string().trim().min(1, 'Name the sale (e.g. Black Friday)').max(60),
    percentOff: z.number().int().min(1).max(95),
    /** Everything, some categories, or some items (by ID). */
    target: z.enum(['all', 'categories', 'items']),
    targetIds: z.array(shopId).max(100),
    /** Unix milliseconds. */
    startsAt: z.number().int().min(0),
    endsAt: z.number().int().min(0),
    /** Post an announcement (and ping the sale role) when it starts. */
    announce: z.boolean(),
  })
  .strict()
  .refine((s) => s.endsAt > s.startsAt, 'A sale has to end after it starts')
  .refine((s) => s.target === 'all' || s.targetIds.length > 0, 'Pick what the sale is on');
export type ShopSale = z.infer<typeof shopSaleSchema>;

export const shopCodeSchema = z
  .object({
    code: z.string().regex(/^[A-Z0-9-]{3,20}$/, 'Codes are 3–20 capital letters, numbers or dashes'),
    percentOff: z.number().int().min(1).max(95),
    /** 0 = unlimited. */
    maxUses: z.number().int().min(0).max(100_000),
    /** Unix milliseconds, or null = never expires. */
    endsAt: z.number().int().min(0).nullable(),
  })
  .strict();
export type ShopCode = z.infer<typeof shopCodeSchema>;

export const shopConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** Where the bot keeps the price list (it edits its own messages, so prices change in place). */
    channelId: channel,
    /** Text above the list (title, small print). */
    header: template(1000),
    /** Line between sections, e.g. ✦ ･ﾟ: *✧･ﾟ:* ✦ — empty for none. */
    divider: z.string().max(200),
    /** Text under the list (e.g. where payment info is). */
    footer: template(1000),
    currency: z.string().trim().min(1, 'Set a currency sign').max(5),
    /** Symbol in front of every item, e.g. ✦ — empty for none. */
    bullet: z.string().max(16),
    categories: z.array(shopCategorySchema).max(15),
    /** Taking orders right now: the list says so and the Order button works. */
    ordersOpen: z.boolean(),
    closedMessage: z.string().max(300),
    /** An Order button under the list: pick an item, describe it, and a ticket opens with the price. Needs Tickets. */
    orderButton: z.boolean(),
    /** Which ticket panel orders open as ('' = the main one). */
    ticketPanelId: z.union([z.literal(''), shopId]),
    sales: z.array(shopSaleSchema).max(20),
    announceChannelId: channel,
    announceRoleId: snowflakeSchema.nullable(),
    codes: z.array(shopCodeSchema).max(25),
    /** /vouch posts reviews here (off when empty). */
    vouchChannelId: channel,
  })
  .strict()
  .refine((c) => new Set(c.codes.map((x) => x.code)).size === c.codes.length, 'Two discount codes have the same name');
export type ShopConfig = z.infer<typeof shopConfigSchema>;

// ─── Modmail ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const modmailConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** A staff-only text channel; every conversation becomes a thread in it. */
    channelId: channel,
    staffRoleIds: roles,
    /** Ping the staff roles when a new conversation starts. */
    pingStaff: z.boolean(),
    /** Staff replies show as "Staff Team" instead of the staff member's name. */
    anonymous: z.boolean(),
    /** DM sent when someone starts a conversation. */
    greeting: template(1000),
    /** DM sent when staff close it. */
    closingMessage: template(1000),
  })
  .strict();
export type ModmailConfig = z.infer<typeof modmailConfigSchema>;

// ─── Applications ─────────────────────────────────────────────────────────────────────────────────────────────────

export const applicationFormSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]{1,12}$/),
    name: z.string().trim().min(1, 'Name the application (e.g. Staff)').max(40),
    panel: panelSchema,
    /** Where answers are posted for staff to accept or deny. */
    reviewChannelId: channel,
    /** Who may accept or deny (Manage Server can always). */
    reviewerRoleIds: roles,
    /** Discord pop-ups hold up to 5 questions. */
    questions: z
      .array(z.object({ label: z.string().trim().min(1, 'Write the question').max(45, 'Questions can be 45 characters long'), style: z.enum(['short', 'paragraph']), required: z.boolean() }).strict())
      .min(1, 'Add at least one question')
      .max(5),
    acceptRoleId: snowflakeSchema.nullable(),
    /** Taken away on accept (e.g. "Applicant"). */
    removeRoleId: snowflakeSchema.nullable(),
    acceptMessage: template(1000),
    denyMessage: template(1000),
    /** Hours before someone can apply again after a decision (0 = straight away). */
    cooldownHours: z.number().int().min(0).max(720),
    /** Open a discussion thread for staff on each application. */
    thread: z.boolean(),
  })
  .strict();
export type ApplicationForm = z.infer<typeof applicationFormSchema>;

export const applicationsConfigSchema = z
  .object({
    enabled: z.boolean(),
    forms: z
      .array(applicationFormSchema)
      .max(10)
      .refine((f) => new Set(f.map((x) => x.id)).size === f.length, 'Form IDs must be unique'),
  })
  .strict();
export type ApplicationsConfig = z.infer<typeof applicationsConfigSchema>;

// ─── Economy ──────────────────────────────────────────────────────────────────────────────────────────────────────

const coins = z.number().int().min(0).max(1_000_000_000);

export const economyConfigSchema = z
  .object({
    enabled: z.boolean(),
    currencyName: z.string().trim().min(1, 'Name the currency').max(20),
    currencyEmoji: z.string().trim().max(64),
    startingBalance: coins,
    daily: z.object({ amount: coins, streakBonus: coins, maxStreak: z.number().int().min(1).max(365) }).strict(),
    work: z
      .object({ min: coins, max: coins, cooldownMinutes: z.number().int().min(1).max(1440) })
      .strict()
      .refine((w) => w.min <= w.max, 'The lowest pay must not be higher than the highest'),
    /** Coins for chatting, at most once per cooldown. */
    chat: z
      .object({ enabled: z.boolean(), min: coins, max: coins, cooldownSeconds: z.number().int().min(10).max(3600) })
      .strict()
      .refine((w) => w.min <= w.max, 'The lowest amount must not be higher than the highest'),
    rob: z
      .object({
        enabled: z.boolean(),
        /** Chance a robbery works. */
        successPercent: z.number().int().min(1).max(90),
        /** At most this share of the victim's wallet is taken. */
        maxStealPercent: z.number().int().min(1).max(100),
        /** On failure the robber pays this share of their own wallet to the victim. */
        finePercent: z.number().int().min(0).max(100),
        cooldownMinutes: z.number().int().min(1).max(1440),
        /** Victims with less than this in their wallet can't be robbed. */
        minWallet: coins,
      })
      .strict(),
    /** /coinflip and /slots. */
    gambling: z.object({ enabled: z.boolean(), maxBet: z.number().int().min(1).max(1_000_000_000) }).strict(),
    shop: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9]{1,12}$/),
            name: z.string().trim().min(1, 'Name the item').max(40),
            price: z.number().int().min(1).max(1_000_000_000),
            /** Buying gives this role (null = just an item in the inventory). */
            roleId: snowflakeSchema.nullable(),
            description: z.string().max(100),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();
export type EconomyConfig = z.infer<typeof economyConfigSchema>;

// ─── Counting & games ─────────────────────────────────────────────────────────────────────────────────────────────

export const gamesConfigSchema = z
  .object({
    enabled: z.boolean(),
    counting: z
      .object({
        /** The counting channel (null = off). */
        channelId: channel,
        /** The same person can't count twice in a row. */
        noDoubleCount: z.boolean(),
        /** "reset": a wrong number starts again from 1. "delete": wrong numbers are just removed. */
        onFail: z.enum(['reset', 'delete']),
      })
      .strict(),
    trivia: z
      .object({
        enabled: z.boolean(),
        seconds: z.number().int().min(10).max(120),
        /** Coins for the winner when Economy is on (0 = none). */
        reward: z.number().int().min(0).max(1_000_000),
        /** Your own questions, mixed in with the built-in ones. */
        custom: z
          .array(
            z
              .object({
                question: z.string().trim().min(1, 'Write the question').max(200),
                correct: z.string().trim().min(1, 'Write the right answer').max(80),
                wrong: z.array(z.string().trim().min(1, 'Write a wrong answer').max(80)).min(1).max(3),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
    /** /rps and /8ball. */
    fun: z.boolean(),
  })
  .strict();
export type GamesConfig = z.infer<typeof gamesConfigSchema>;

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
  invites: invitesConfigSchema,
  starboard: starboardConfigSchema,
  tempVoice: tempVoiceConfigSchema,
  antiRaid: antiRaidConfigSchema,
  sticky: stickyConfigSchema,
  serverStats: serverStatsConfigSchema,
  birthdays: birthdaysConfigSchema,
  feeds: feedsConfigSchema,
  scheduled: scheduledConfigSchema,
  shop: shopConfigSchema,
  modmail: modmailConfigSchema,
  applications: applicationsConfigSchema,
  economy: economyConfigSchema,
  games: gamesConfigSchema,
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
      style: { embed: true, color: '#7c5cff', title: 'Welcome!', imageUrl: '' },
      buttons: [],
      extraMessages: [],
      deleteAfterSeconds: 0,
    },
    dm: { enabled: false, message: 'Hi {user.name}, welcome to {server}! Make sure to read the rules.' },
    goodbye: { enabled: false, channelId: null, message: '**{user.name}** has left the server. 👋', embed: false, color: '#f04d5e' },
    autoRoles: { roleIds: [], botRoleIds: [], delayMinutes: 0 },
    pingChannelIds: [],
    boost: { enabled: false, channelId: null, message: '💜 {user} just boosted the server — thank you! We now have {boosts} boosts.' },
  },
  moderation: {
    enabled: false,
    logChannelId: null,
    dmMembers: true,
    thresholds: [{ warnings: 3, action: 'timeout', minutes: 60 }],
    warnExpiryDays: 0,
    appealMessage: '',
    dehoist: false,
    automod: {
      enabled: false,
      exemptRoleIds: [],
      exemptChannelIds: [],
      timeoutMinutes: 10,
      spam: { enabled: true, maxMessages: 6, perSeconds: 5, action: 'timeout' },
      links: { enabled: false, allowedDomains: ['youtube.com', 'youtu.be', 'twitch.tv'], action: 'delete' },
      words: { enabled: false, words: [], action: 'delete' },
      invites: { enabled: true, action: 'delete' },
      caps: { enabled: false, minLength: 10, percent: 70, action: 'delete' },
      mentions: { enabled: true, max: 5, action: 'timeout' },
      emoji: { enabled: false, max: 10, action: 'delete' },
      scams: { enabled: true, action: 'delete' },
      repeats: { enabled: false, count: 3, action: 'warn' },
      zalgo: { enabled: false, action: 'delete' },
      lines: { enabled: false, max: 15, action: 'delete' },
      newMemberLinks: { enabled: false, hours: 24, action: 'delete' },
    },
  },
  logging: {
    enabled: false,
    channelId: null,
    events: LOG_EVENT_DEFAULTS,
    channelOverrides: {},
    ignoredChannelIds: [],
    ignoredRoleIds: [],
  },
  utility: {
    enabled: false,
    commands: { serverinfo: true, userinfo: true, avatar: true, poll: true, remind: true, roll: true, afk: true, roleinfo: true, channelinfo: true, membercount: true, choose: true, emoji: true, timestamp: true, banner: true },
    bumpReminder: { enabled: false, roleId: null },
  },
  leveling: {
    enabled: false,
    xpMin: 15,
    xpMax: 25,
    cooldownSeconds: 60,
    levelUp: { enabled: true, channelId: null, message: '🎉 {user} reached **level {level}**!', dm: false },
    rewards: [],
    stackRewards: true,
    noXpChannelIds: [],
    noXpRoleIds: [],
    multipliers: [],
    voiceXpPerMinute: 0,
    resetOnLeave: false,
    weekendDoubleXp: false,
    announceEvery: 1,
    channelMultipliers: [],
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
    askReason: false,
    claimButton: true,
    autoCloseHours: 0,
    pingStaff: true,
    logChannelId: null,
    feedback: false,
    extraPanels: [],
  },
  verification: {
    enabled: false,
    roleId: null,
    removeRoleId: null,
    panel: panel('Verify to get access', 'Click the button below to unlock the rest of the server.', 'Verify', '#3dd68c'),
    minAccountAgeDays: 0,
    logChannelId: null,
    challenge: 'none',
    kickAfterHours: 0,
    dmMessage: '',
  },
  reactionRoles: { enabled: false, panels: [] },
  suggestions: { enabled: false, channelId: null, staffRoleIds: [], threads: false, anonymous: false, dmOnDecision: true, cooldownMinutes: 0 },
  giveaways: { enabled: false, managerRoleIds: [], color: '#f5a524', bonusRoles: [], minAccountAgeDays: 0, minMemberDays: 0, dmWinners: true },
  invites: { enabled: false, channelId: null, message: '{user} joined using {inviter}’s invite — that’s {invites} so far.', rewards: [] },
  starboard: { enabled: false, channelId: null, emoji: '⭐', threshold: 3, selfStar: false, ignoredChannelIds: [] },
  tempVoice: { enabled: false, hubChannelId: null, categoryId: null, nameTemplate: '{user}’s channel', userLimit: 0, ownerCommands: true, extraHubs: [] },
  antiRaid: { enabled: false, alertChannelId: null, joinThreshold: 10, perSeconds: 30, raidAction: 'alert', raidMinutes: 10, minAccountAgeDays: 0, lockdown: false, pauseInvites: false, antiNuke: { enabled: false, maxActions: 5, perSeconds: 60, action: 'strip', trustedUserIds: [] } },
  sticky: { enabled: false, messages: [], quietSeconds: 5 },
  serverStats: { enabled: false, counters: [] },
  birthdays: { enabled: false, channelId: null, message: '🎂 Happy birthday {user}! Have a great day.', roleId: null, hourUtc: 9, dmMessage: '' },
  feeds: { enabled: false, feeds: [] },
  scheduled: { enabled: false, timezone: 'UTC', messages: [] },
  shop: {
    enabled: false,
    channelId: null,
    header: '# 💸 ***PRICE LIST***\n-# All prices in USD',
    divider: '✦ ･ﾟ: *✧･ﾟ:* ✦ *:･ﾟ✧*:･ﾟ ✦',
    footer: '-# Open a ticket to order',
    currency: '$',
    bullet: '✦',
    categories: [],
    ordersOpen: true,
    closedMessage: 'We’re not taking new orders right now — check back soon!',
    orderButton: true,
    ticketPanelId: '',
    sales: [],
    announceChannelId: null,
    announceRoleId: null,
    codes: [],
    vouchChannelId: null,
  },
  modmail: {
    enabled: false,
    channelId: null,
    staffRoleIds: [],
    pingStaff: true,
    anonymous: false,
    greeting: 'Thanks for your message! The staff team will reply here as soon as they can.',
    closingMessage: 'This conversation was closed by staff. Message me again any time if you need help.',
  },
  applications: { enabled: false, forms: [] },
  economy: {
    enabled: false,
    currencyName: 'coins',
    currencyEmoji: '🪙',
    startingBalance: 100,
    daily: { amount: 200, streakBonus: 20, maxStreak: 30 },
    work: { min: 50, max: 200, cooldownMinutes: 60 },
    chat: { enabled: true, min: 1, max: 5, cooldownSeconds: 60 },
    rob: { enabled: true, successPercent: 40, maxStealPercent: 25, finePercent: 10, cooldownMinutes: 120, minWallet: 100 },
    gambling: { enabled: true, maxBet: 5000 },
    shop: [],
  },
  games: {
    enabled: false,
    counting: { channelId: null, noDoubleCount: true, onFail: 'reset' },
    trivia: { enabled: true, seconds: 20, reward: 50, custom: [] },
    fun: true,
  },
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
  { id: 'moderation', name: 'Moderation', summary: 'Staff commands with numbered cases and history, temporary bans, channel lockdown, and auto-moderation for spam, scams, mentions and more.', feature: 'modules.basic', available: true, commands: ['/warn', '/warnings', '/unwarn', '/clearwarnings', '/history', '/case', '/note', '/timeout', '/untimeout', '/kick', '/ban', '/unban', '/softban', '/purge', '/lock', '/unlock', '/slowmode', '/role', '/nick'] },
  { id: 'logging', name: 'Logging', summary: 'Who did what: deleted and edited messages, joins and leaves, and every staff change with who made it.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'utility', name: 'Utility', summary: 'Handy commands: server info, user info, avatars and native Discord polls.', feature: 'modules.basic', available: true, commands: ['/serverinfo', '/userinfo', '/avatar', '/poll', '/remind', '/roll'] },
  { id: 'leveling', name: 'Leveling', summary: 'XP for chatting, levels, leaderboards and role rewards.', feature: 'modules.standard', available: true, commands: ['/rank', '/leaderboard', '/xp'] },
  { id: 'tickets', name: 'Tickets', summary: 'A support panel that opens private ticket channels, with transcripts when closed.', feature: 'modules.standard', available: true, commands: ['/ticket add', '/ticket remove', '/ticket rename', '/ticket claim', '/ticket unclaim', '/ticket transfer', '/ticket priority', '/ticket closerequest', '/ticket close', '/ticket stats'] },
  { id: 'verification', name: 'Verification', summary: 'A verify button that gives new members access, with an optional minimum account age.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'reactionRoles', name: 'Reaction Roles', summary: 'Panels where members pick their own roles with buttons or a menu.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'suggestions', name: 'Suggestions', summary: 'Members submit ideas, others vote, staff approve or reject.', feature: 'modules.standard', available: true, commands: ['/suggest'] },
  { id: 'giveaways', name: 'Giveaways', summary: 'Timed giveaways with a join button and automatic, fair winner picking.', feature: 'modules.standard', available: true, commands: ['/giveaway start', '/giveaway end', '/giveaway reroll'] },
  { id: 'invites', name: 'Invite Tracker', summary: 'See who invited each new member, invite counts and a leaderboard.', feature: 'modules.standard', available: true, commands: ['/invites', '/inviteboard'] },
  { id: 'starboard', name: 'Starboard', summary: 'Messages that get enough ⭐ reactions are showcased in a starboard channel.', feature: 'modules.standard', available: true, commands: ['/stars'] },
  { id: 'tempVoice', name: 'Temporary Voice', summary: 'Join a “create channel” voice channel to get your own room; it disappears when empty.', feature: 'modules.standard', available: true, commands: ['/voice'] },
  { id: 'antiRaid', name: 'Raid Protection', summary: 'Spots join floods, alerts staff and keeps brand-new accounts out.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'sticky', name: 'Sticky Messages', summary: 'Keep a message pinned to the bottom of a busy channel.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'serverStats', name: 'Server Stats', summary: 'Channel names that show live member, bot and boost counts.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'feeds', name: 'Social Alerts', summary: 'Announce new YouTube videos and posts from any news or RSS feed.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'scheduled', name: 'Scheduled Messages', summary: 'Post announcements automatically on chosen days and times.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'modmail', name: 'Modmail', summary: 'Members DM the bot to reach your staff privately; every conversation is a staff-only thread and staff reply through the bot.', feature: 'modules.standard', available: true, commands: ['/modmail open', '/modmail close', '/modmail block', '/modmail unblock'] },
  { id: 'applications', name: 'Applications', summary: 'Staff, partner or any other applications: a form with your questions, a review channel, and Accept/Deny that gives roles and DMs the applicant.', feature: 'modules.standard', available: true, commands: [] },
  { id: 'economy', name: 'Economy', summary: 'Server coins: daily rewards, work, pay, rob, gambling, a leaderboard and a shop where members buy roles.', feature: 'modules.standard', available: true, commands: ['/balance', '/daily', '/work', '/pay', '/deposit', '/withdraw', '/rob', '/rich', '/shopitems', '/buy', '/inventory', '/coinflip', '/slots', '/eco'] },
  { id: 'games', name: 'Counting & Games', summary: 'A counting channel with records, plus trivia (with coin prizes), rock-paper-scissors and the magic 8-ball.', feature: 'modules.standard', available: true, commands: ['/count', '/trivia', '/rps', '/8ball'] },
  { id: 'shop', name: 'Shop', summary: 'Your price list, kept up to date by the bot: sales that start and end on their own, an Order button that opens a ticket with the price, discount codes and vouches.', feature: 'modules.standard', available: true, commands: ['/price', '/vouch'] },
  { id: 'birthdays', name: 'Birthdays', summary: 'Members save their birthday; the bot celebrates them with a message and a role.', feature: 'modules.standard', available: true, commands: ['/birthday set', '/birthday remove', '/birthday upcoming'] },
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
    case 'moderation': {
      const m = config as ModerationConfig;
      return (m.automod.enabled ? I('GuildMessages', 'MessageContent') : 0) | (m.dehoist ? I('GuildMembers') : 0);
    }
    case 'logging': {
      const e = (config as LoggingConfig).events;
      let bits = 0;
      if (e.messageDelete || e.messageEdit) bits |= I('GuildMessages', 'MessageContent');
      if (e.memberJoin || e.memberLeave) bits |= I('GuildMembers');
      // Discord's live audit-log feed (who did what) arrives with the Moderation intent.
      if (AUDIT_LOG_EVENTS.some((k) => e[k])) bits |= I('GuildModeration');
      if (e.voice) bits |= I('GuildVoiceStates');
      return bits;
    }
    case 'leveling': {
      const l = config as LevelingConfig;
      // Message events arrive without the privileged content intent; voice XP needs voice states, reset-on-leave members.
      return I('GuildMessages') | (l.voiceXpPerMinute ? I('GuildVoiceStates') : 0) | (l.resetOnLeave ? I('GuildMembers') : 0);
    }
    case 'invites':
      return I('GuildInvites', 'GuildMembers');
    case 'starboard':
      return I('GuildMessageReactions', 'GuildMessages', 'MessageContent');
    case 'tempVoice':
      return I('GuildVoiceStates');
    case 'antiRaid':
      // Anti-nuke watches the audit log.
      return I('GuildMembers') | ((config as AntiRaidConfig).antiNuke.enabled ? I('GuildModeration') : 0);
    case 'modmail':
      // DMs to the bot, and staff replies typed in the thread.
      return I('DirectMessages', 'GuildMessages', 'MessageContent');
    case 'economy':
      return (config as EconomyConfig).chat.enabled ? I('GuildMessages') : 0;
    case 'games':
      return (config as GamesConfig).counting.channelId ? I('GuildMessages', 'MessageContent') : 0;
    case 'utility': {
      const u = config as UtilityConfig;
      // AFK notices and the bump reminder watch messages (mentions and DISBOARD's reply don't need message content).
      return u.commands.afk || u.bumpReminder.enabled ? I('GuildMessages') : 0;
    }
    case 'verification':
      // Finding members who never verified needs the member list.
      return (config as VerificationConfig).kickAfterHours ? I('GuildMembers') : 0;
    case 'sticky':
      return I('GuildMessages');
    case 'serverStats':
      // Counting humans and bots needs the member list.
      return (config as ServerStatsConfig).counters.some((c) => /\{(humans|bots)\}/.test(c.template)) ? I('GuildMembers') : 0;
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
  { key: '{user.created}', description: 'When their account was made (e.g. “3 years ago”)' },
  { key: '{user.joined}', description: 'When they joined the server (e.g. “2 months ago”) — handy in goodbyes' },
  { key: '{boosts}', description: 'Number of server boosts' },
] as const;

/** Replaces {variables}; unknown ones are left untouched so typos are visible. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  // Keys like {user.name}, {option:NAME} and {var:name}; unknown ones are left as written.
  return template.replace(/\{([a-zA-Z][\w.:-]*)\}/g, (match, key: string) =>
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
/** True when a message is mostly capital letters (ignoring short messages). */
export function isCapsSpam(text: string, minLength: number, percent: number): boolean {
  const letters = text.replace(/<a?:\w+:\d+>|https?:\/\/\S+|<[@#&!]+\d+>/g, '').replace(/[^\p{L}]/gu, '');
  if (letters.length < minLength) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  return (upper / letters.length) * 100 >= percent;
}

/** Normal and server emojis in a message. */
export function countEmoji(text: string): number {
  return (text.match(/<a?:\w+:\d+>/g)?.length ?? 0) + (text.replace(/<a?:\w+:\d+>/g, '').match(/\p{Extended_Pictographic}/gu)?.length ?? 0);
}

const OFFICIAL_HOSTS = ['discord.com', 'discord.dev', 'discord.new', 'discord.co', 'discords.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media', 'discord.gift', 'discordstatus.com', 'steampowered.com', 'steamcommunity.com', 'steamstatic.com'];
const IMITATED = ['discord', 'discordapp', 'discordgift', 'steamcommunity', 'steampowered', 'steamcommunlty'];

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/**
 * Links that pretend to be Discord or Steam (the usual "free Nitro" / "Steam gift" account-stealing scams):
 * look-alike domains such as dlscord-nitro.gift or steamcornmunity.com. Real Discord and Steam links are fine.
 */
export function scamLinks(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>]+/gi)) {
    let host: string;
    try {
      host = new URL(match[0]).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      continue;
    }
    if (OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    const name = host.split('.').slice(0, -1).join('').replace(/[^a-z0-9]/g, '');
    const lookalike = IMITATED.some((w) => name.length >= 5 && (editDistance(name, w) <= 2 || (name.includes(w.slice(0, 5)) && /nitro|gift|free|airdrop|promo/.test(name))));
    if (lookalike || (/n[i1]tro/.test(name) && /d[i1l]sc|gift|free/.test(name))) found.push(host);
  }
  return found;
}

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
      return base | HISTORY | P(1n) | P(2n) | P(40n) | P(13n) | ((config as ModerationConfig).dehoist ? P(27n) : 0n);
    case 'logging':
      return base | P(7n);
    case 'leveling':
      return base | ((config as LevelingConfig).rewards.length ? ROLES : 0n);
    case 'tickets':
      return base | HISTORY | ROLES | P(4n) | P(15n); // manage channels + attach transcripts
    case 'verification':
      return base | ROLES | ((config as VerificationConfig).kickAfterHours ? P(1n) : 0n);
    case 'reactionRoles':
      return base | ROLES;
    case 'suggestions':
      return base | ((config as SuggestionsConfig).threads ? P(35n) | P(38n) : 0n); // create threads + talk in them
    case 'giveaways':
    case 'starboard':
    case 'sticky':
      return base | HISTORY;
    case 'invites':
      return base | P(5n) | ((config as InvitesConfig).rewards.length ? ROLES : 0n); // Manage Server: needed to read invite links
    case 'tempVoice':
      return VIEW | P(4n) | P(20n) | P(24n) | ((config as TempVoiceConfig).ownerCommands ? P(28n) : 0n); // manage channels, connect, move members (+ permissions for /voice lock)
    case 'antiRaid': {
      const a = config as AntiRaidConfig;
      // kick, ban (+ Manage Server for lockdown / pausing invites, View Audit Log + Manage Roles for anti-nuke)
      return base | P(1n) | P(2n) | (a.lockdown || a.pauseInvites ? P(5n) : 0n) | (a.antiNuke.enabled ? P(7n) | ROLES : 0n);
    }
    case 'serverStats':
      return VIEW | P(4n) | P(20n); // rename channels
    case 'birthdays':
      return base | ((config as BirthdaysConfig).roleId ? ROLES : 0n);
    case 'feeds':
      // Mention Everyone lets the bot ping roles that aren't set to "anyone can mention".
      return base | ((config as FeedsConfig).feeds.some((f) => f.roleId) ? P(17n) : 0n);
    case 'scheduled':
      return base | ((config as ScheduledConfig).messages.some((m) => m.roleId) ? P(17n) : 0n);
    case 'shop':
      return base | HISTORY | ((config as ShopConfig).announceRoleId ? P(17n) : 0n);
    case 'modmail':
      return base | HISTORY | P(6n) | P(15n) | P(34n) | P(35n) | P(38n); // reactions, files, manage + create threads, talk in threads
    case 'applications':
      return base | ROLES | ((config as ApplicationsConfig).forms.some((f) => f.thread) ? P(35n) | P(38n) : 0n);
    case 'economy':
      return base | ((config as EconomyConfig).shop.some((s) => s.roleId) ? ROLES : 0n);
    case 'games':
      return base | HISTORY | P(6n) | P(13n); // reactions, delete wrong numbers
    default:
      return base;
  }
}
