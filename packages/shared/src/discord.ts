import { z } from 'zod';

/**
 * Discord platform definitions used by the wizard, the runtime and validation.
 * Values follow the official Discord API v10 documentation.
 */

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'Invalid Discord ID');

// ─── Gateway intents ──────────────────────────────────────────────────────────────────────────────────────────────

export interface IntentInfo {
  key: string;
  bit: number;
  label: string;
  description: string;
  /** Must be switched on manually in the Developer Portal (Bot → Privileged Gateway Intents). */
  privileged: boolean;
}

export const INTENTS: readonly IntentInfo[] = [
  { key: 'Guilds', bit: 1 << 0, label: 'Servers', description: 'Know which servers, channels and roles the bot is in. Required by every bot.', privileged: false },
  { key: 'GuildMembers', bit: 1 << 1, label: 'Server Members', description: 'See members joining, leaving and changing — needed for welcome messages, auto-roles and logging.', privileged: true },
  { key: 'GuildModeration', bit: 1 << 2, label: 'Moderation', description: 'Receive ban and audit-log events.', privileged: false },
  { key: 'GuildExpressions', bit: 1 << 3, label: 'Emojis & Stickers', description: 'Emoji and sticker updates.', privileged: false },
  { key: 'GuildInvites', bit: 1 << 6, label: 'Invites', description: 'Know when invite links are created or deleted (invite tracking).', privileged: false },
  { key: 'GuildVoiceStates', bit: 1 << 7, label: 'Voice States', description: 'See who joins or leaves voice channels.', privileged: false },
  { key: 'GuildPresences', bit: 1 << 8, label: 'Presence', description: 'See members’ online status and activities. Rarely needed.', privileged: true },
  { key: 'GuildMessages', bit: 1 << 9, label: 'Server Messages', description: 'Receive message events in servers (for logging, leveling, auto-moderation).', privileged: false },
  { key: 'GuildMessageReactions', bit: 1 << 10, label: 'Reactions', description: 'Receive reaction events.', privileged: false },
  { key: 'DirectMessages', bit: 1 << 12, label: 'Direct Messages', description: 'Receive direct messages sent to the bot.', privileged: false },
  { key: 'MessageContent', bit: 1 << 15, label: 'Message Content', description: 'Read the text of messages — needed for word filters and XP from chatting.', privileged: true },
  { key: 'GuildScheduledEvents', bit: 1 << 16, label: 'Scheduled Events', description: 'Server event updates.', privileged: false },
  { key: 'AutoModerationExecution', bit: 1 << 21, label: 'AutoMod Actions', description: 'Know when Discord AutoMod takes action.', privileged: false },
];

export const INTENT_BITS = Object.fromEntries(INTENTS.map((i) => [i.key, i.bit])) as Record<string, number>;
/** What a bot needs with no modules enabled (Phase 4 modules add their own requirements). */
export const BASE_INTENTS = 1 << 0;

/** Application flags that show which privileged intents are enabled in the Developer Portal. */
const APP_FLAGS = {
  GatewayPresence: 1 << 12,
  GatewayPresenceLimited: 1 << 13,
  GatewayGuildMembers: 1 << 14,
  GatewayGuildMembersLimited: 1 << 15,
  GatewayMessageContent: 1 << 18,
  GatewayMessageContentLimited: 1 << 19,
} as const;

export interface PrivilegedIntentStatus {
  GuildPresences: boolean;
  GuildMembers: boolean;
  MessageContent: boolean;
}

export function privilegedIntentsFromFlags(flags: number): PrivilegedIntentStatus {
  const on = (a: number, b: number) => (flags & a) !== 0 || (flags & b) !== 0;
  return {
    GuildPresences: on(APP_FLAGS.GatewayPresence, APP_FLAGS.GatewayPresenceLimited),
    GuildMembers: on(APP_FLAGS.GatewayGuildMembers, APP_FLAGS.GatewayGuildMembersLimited),
    MessageContent: on(APP_FLAGS.GatewayMessageContent, APP_FLAGS.GatewayMessageContentLimited),
  };
}

/** Privileged intents the bot asks for that are not enabled in the portal — login would fail with 4014. */
export function missingPrivilegedIntents(intents: number, flags: number): IntentInfo[] {
  const status = privilegedIntentsFromFlags(flags);
  return INTENTS.filter(
    (i) => i.privileged && (intents & i.bit) !== 0 && !status[i.key as keyof PrivilegedIntentStatus],
  );
}

// ─── Permissions ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface PermissionInfo {
  key: string;
  bit: bigint;
  label: string;
  description: string;
  group: 'basic' | 'moderation' | 'management' | 'dangerous';
}

export const PERMISSIONS: readonly PermissionInfo[] = [
  { key: 'ViewChannel', bit: 1n << 10n, label: 'View Channels', description: 'See channels.', group: 'basic' },
  { key: 'SendMessages', bit: 1n << 11n, label: 'Send Messages', description: 'Post messages.', group: 'basic' },
  { key: 'SendMessagesInThreads', bit: 1n << 38n, label: 'Send Messages in Threads', description: 'Reply inside threads.', group: 'basic' },
  { key: 'EmbedLinks', bit: 1n << 14n, label: 'Embed Links', description: 'Send rich embeds.', group: 'basic' },
  { key: 'AttachFiles', bit: 1n << 15n, label: 'Attach Files', description: 'Upload images and files.', group: 'basic' },
  { key: 'ReadMessageHistory', bit: 1n << 16n, label: 'Read Message History', description: 'Read earlier messages.', group: 'basic' },
  { key: 'AddReactions', bit: 1n << 6n, label: 'Add Reactions', description: 'React to messages.', group: 'basic' },
  { key: 'UseExternalEmojis', bit: 1n << 18n, label: 'Use External Emojis', description: 'Use emojis from other servers.', group: 'basic' },
  { key: 'KickMembers', bit: 1n << 1n, label: 'Kick Members', description: 'Remove members from the server.', group: 'moderation' },
  { key: 'BanMembers', bit: 1n << 2n, label: 'Ban Members', description: 'Ban members.', group: 'moderation' },
  { key: 'ModerateMembers', bit: 1n << 40n, label: 'Timeout Members', description: 'Put members in timeout.', group: 'moderation' },
  { key: 'ManageMessages', bit: 1n << 13n, label: 'Manage Messages', description: 'Delete or pin others’ messages.', group: 'moderation' },
  { key: 'ManageNicknames', bit: 1n << 27n, label: 'Manage Nicknames', description: 'Change members’ nicknames.', group: 'moderation' },
  { key: 'ViewAuditLog', bit: 1n << 7n, label: 'View Audit Log', description: 'Read the server audit log.', group: 'moderation' },
  { key: 'ManageRoles', bit: 1n << 28n, label: 'Manage Roles', description: 'Give and remove roles (auto-roles, reaction roles, rewards).', group: 'management' },
  { key: 'ManageChannels', bit: 1n << 4n, label: 'Manage Channels', description: 'Create and edit channels (tickets).', group: 'management' },
  { key: 'ManageThreads', bit: 1n << 34n, label: 'Manage Threads', description: 'Archive and manage threads.', group: 'management' },
  { key: 'ManageWebhooks', bit: 1n << 29n, label: 'Manage Webhooks', description: 'Create webhooks.', group: 'management' },
  { key: 'CreateInstantInvite', bit: 1n << 0n, label: 'Create Invite', description: 'Create invite links.', group: 'management' },
  { key: 'Administrator', bit: 1n << 3n, label: 'Administrator', description: 'Every permission, bypassing channel overrides. Not recommended — if the bot is ever compromised, so is your server.', group: 'dangerous' },
];

const bits = (...keys: string[]) =>
  PERMISSIONS.filter((p) => keys.includes(p.key)).reduce((acc, p) => acc | p.bit, 0n);

export const PERMISSION_PRESETS = {
  basic: bits('ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions', 'UseExternalEmojis'),
  moderation: bits(
    'ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions', 'UseExternalEmojis',
    'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageNicknames', 'ViewAuditLog',
  ),
  full: bits(
    'ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions', 'UseExternalEmojis',
    'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageNicknames', 'ViewAuditLog',
    'ManageRoles', 'ManageChannels', 'ManageThreads', 'ManageWebhooks', 'CreateInstantInvite',
  ),
} as const;

/** Permissions are 64-bit, so they travel as decimal strings. */
export const permissionsSchema = z
  .string()
  .regex(/^\d{1,20}$/, 'Invalid permissions value')
  .refine((v) => BigInt(v) < 1n << 64n, 'Invalid permissions value');

export function buildInviteUrl(applicationId: string, permissions: string): string {
  const params = new URLSearchParams({
    client_id: applicationId,
    scope: 'bot applications.commands',
    permissions,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

// ─── Presence ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const presenceSchema = z
  .object({
    status: z.enum(['online', 'idle', 'dnd', 'invisible']),
    activity: z
      .object({
        type: z.enum(['playing', 'listening', 'watching', 'competing', 'custom']),
        text: z.string().trim().min(1, 'Enter the activity text').max(128, 'At most 128 characters'),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type BotPresence = z.infer<typeof presenceSchema>;
export const DEFAULT_PRESENCE: BotPresence = { status: 'online', activity: null };

// ─── Tokens ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type TokenCheck = { ok: true; token: string } | { ok: false; message: string };

const TOKEN_RE = /^[A-Za-z\d_-]{23,28}\.[A-Za-z\d_-]{6,7}\.[A-Za-z\d_-]{27,}$/;

/**
 * Local sanity check before contacting Discord. Recognises the values beginners most often paste by mistake
 * (Application ID, Public Key, Client Secret) and explains what to copy instead.
 */
export function checkTokenShape(raw: string): TokenCheck {
  const token = raw.trim().replace(/^Bot\s+/i, '');
  if (token === '') return { ok: false, message: 'Paste your bot token.' };
  if (/^\d{17,20}$/.test(token)) {
    return { ok: false, message: 'That looks like your Application ID. Open the Bot tab and copy the bot Token instead.' };
  }
  if (/^[a-f0-9]{64}$/i.test(token)) {
    return { ok: false, message: 'That looks like your Public Key. Open the Bot tab and copy the bot Token instead.' };
  }
  if (/^[A-Za-z0-9_-]{32}$/.test(token)) {
    return { ok: false, message: 'That looks like your Client Secret (from the OAuth2 tab). Open the Bot tab and copy the bot Token instead.' };
  }
  if (/\s/.test(token)) return { ok: false, message: 'The token contains spaces — copy it again without extra characters.' };
  if (!TOKEN_RE.test(token)) {
    return { ok: false, message: 'That doesn’t look like a Discord bot token. Use Reset Token on the Bot tab and copy the full value.' };
  }
  return { ok: true, token };
}

/** "…x9Qa" — enough to recognise which token is stored, useless to an attacker. */
export function tokenHint(token: string): string {
  return `…${token.slice(-4)}`;
}

export function discordAvatarUrl(userId: string, avatarHash: string | null): string | null {
  if (!avatarHash) return null;
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=128`;
}

export const DEVELOPER_PORTAL_URL = 'https://discord.com/developers/applications';
