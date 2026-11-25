import type { LogEvent } from '@delyforge/shared';
import {
  type APIEmbed,
  type APIEmbedField,
  AuditLogEvent,
  type Guild,
  type GuildMember,
  type Message,
  type PartialGuildMember,
  type PartialMessage,
  PermissionsBitField,
  type VoiceState,
} from 'discord.js';
import { COLORS, type ModuleContext, sendableChannel, truncate } from './context.js';

/**
 * Logging. Message edits/deletes, joins/leaves and voice come from their own events; everything staff do (channels,
 * roles, permissions, nicknames, timeouts, kicks, bans, server settings, invites, pins…) comes from Discord's live
 * audit-log feed, which says who did it, what changed and why.
 */

async function post(ctx: ModuleContext, guild: Guild, event: LogEvent, embed: APIEmbed, sourceChannelId?: string): Promise<void> {
  const config = ctx.config(guild.id).logging;
  if (!config.enabled || !config.events[event]) return;
  const channelId = config.channelOverrides[event] ?? config.channelId;
  if (sourceChannelId && (sourceChannelId === channelId || sourceChannelId === config.channelId || config.ignoredChannelIds.includes(sourceChannelId))) return;
  const channel = await sendableChannel(ctx, guild, channelId, 'Logging');
  if (!channel) return;
  await channel
    .send({ embeds: [{ ...embed, timestamp: new Date().toISOString() }], allowedMentions: { parse: [] } })
    .catch((e: Error) => ctx.log('warn', `Logging: could not post: ${e.message}`));
}

const content = (text: string | null | undefined) => (text ? truncate(text, 1000) : '*(no text — the message was sent before the bot started, had only attachments, or Message Content intent is off)*');
const ts = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;

// ─── Who deleted a message ────────────────────────────────────────────────────────────────────────────────────────

/** Discord only audit-logs deletes of *other people's* messages; a match means a moderator did it. */
const recentDeletes = new Map<string, { executorId: string; targetId: string; channelId: string; at: number }[]>();

export function rememberDelete(guildId: string, d: { executorId: string; targetId: string; channelId: string }, now = Date.now()): void {
  const list = (recentDeletes.get(guildId) ?? []).filter((x) => now - x.at < 60_000);
  list.push({ ...d, at: now });
  recentDeletes.set(guildId, list.slice(-50));
}

export function deleterOf(guildId: string, authorId: string, channelId: string, now = Date.now()): string | null {
  const hit = (recentDeletes.get(guildId) ?? []).findLast((x) => x.targetId === authorId && x.channelId === channelId && now - x.at < 30_000);
  return hit?.executorId ?? null;
}

export async function onMessageDelete(ctx: ModuleContext, message: Message | PartialMessage): Promise<void> {
  if (!message.guild || message.author?.bot) return;
  const config = ctx.config(message.guild.id).logging;
  if (!config.enabled || !config.events.messageDelete) return;
  if (message.member?.roles.cache.some((r) => config.ignoredRoleIds.includes(r.id))) return;
  // The audit entry (if a moderator deleted it) arrives just after the delete event.
  // shortcut: Discord merges repeated deletes by the same moderator into one entry without a new event, so only the
  // first of a quick series is attributed; the rest say nothing rather than guess.
  await new Promise((r) => setTimeout(r, 1500));
  const by = message.author ? deleterOf(message.guild.id, message.author.id, message.channelId) : null;
  const files = message.attachments?.size ? `\n**Attachments:** ${truncate(message.attachments.map((a) => a.name).join(', '), 300)}` : '';
  await post(
    ctx,
    message.guild,
    'messageDelete',
    {
      title: 'Message deleted',
      description: `${message.author ? `<@${message.author.id}>` : 'Unknown author'} in <#${message.channelId}>${by ? `\n**Deleted by:** <@${by}>` : ''}${files}\n>>> ${content(message.content)}`,
      color: COLORS.danger,
      footer: { text: `Message ${message.id}${message.author ? ` · Author ${message.author.id}` : ''}` },
    },
    message.channelId,
  );
}

export async function onMessageEdit(ctx: ModuleContext, before: Message | PartialMessage, after: Message | PartialMessage): Promise<void> {
  if (!after.guild || after.author?.bot || before.content === after.content) return;
  if (after.member?.roles.cache.some((r) => ctx.config(after.guild!.id).logging.ignoredRoleIds.includes(r.id))) return;
  await post(
    ctx,
    after.guild,
    'messageEdit',
    {
      title: 'Message edited',
      description: `<@${after.author?.id}> in <#${after.channelId}> — [jump](${after.url})`,
      fields: [
        { name: 'Before', value: content(before.content) },
        { name: 'After', value: content(after.content) },
      ],
      color: COLORS.warn,
      footer: { text: `Message ${after.id}` },
    },
    after.channelId,
  );
}

export async function onMemberJoinLog(ctx: ModuleContext, member: GuildMember, invitedBy: { inviterId: string | null; code: string | null } | null = null): Promise<void> {
  const created = member.user.createdTimestamp;
  const isNew = Date.now() - created < 7 * 86_400_000;
  // Filled in when the Invite Tracker module is on.
  const invite = !invitedBy ? '' : invitedBy.inviterId ? `\nInvited by <@${invitedBy.inviterId}> (\`${invitedBy.code}\`)` : invitedBy.code ? `\nJoined with the custom link \`${invitedBy.code}\`` : '\nInvite: unknown';
  await post(ctx, member.guild, 'memberJoin', {
    title: 'Member joined',
    description: `<@${member.id}> (${member.user.tag})\nAccount created ${ts(created)}${isNew ? ' ⚠️ **new account**' : ''}\nMember #${member.guild.memberCount}${invite}`,
    color: COLORS.success,
    thumbnail: { url: member.user.displayAvatarURL({ size: 128 }) },
    footer: { text: `User ${member.id}` },
  });
}

export async function onMemberLeaveLog(ctx: ModuleContext, member: GuildMember | PartialGuildMember): Promise<void> {
  const roles = member.partial ? [] : member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => `<@&${r.id}>`);
  const stayed = !member.partial && member.joinedTimestamp ? `\nJoined ${ts(member.joinedTimestamp)}` : '';
  await post(ctx, member.guild, 'memberLeave', {
    title: 'Member left',
    description: `<@${member.id}> (${member.user?.tag ?? member.id})${stayed}${roles.length ? `\n**Roles:** ${truncate(roles.join(' '), 900)}` : ''}`,
    color: COLORS.danger,
    footer: { text: `User ${member.id}` },
  });
}

export async function onVoice(ctx: ModuleContext, before: VoiceState, after: VoiceState): Promise<void> {
  if (before.channelId === after.channelId || after.member?.user.bot) return;
  const who = `<@${after.id}>`;
  const description =
    !before.channelId ? `${who} joined <#${after.channelId}>` : !after.channelId ? `${who} left <#${before.channelId}>` : `${who} moved <#${before.channelId}> → <#${after.channelId}>`;
  await post(ctx, after.guild, 'voice', { title: 'Voice', description, color: COLORS.info });
}

// ─── Audit log: who did what ──────────────────────────────────────────────────────────────────────────────────────

/** The fields of a discord.js audit-log entry this module reads (plain objects in tests). */
export interface AuditLike {
  action: AuditLogEvent;
  actionType: string;
  targetType: string;
  targetId: string | null;
  executorId: string | null;
  reason: string | null;
  changes: readonly { key: string; old?: unknown; new?: unknown }[];
  extra: unknown;
}

const A = AuditLogEvent;
const CATEGORY: Partial<Record<AuditLogEvent, LogEvent>> = {
  [A.GuildUpdate]: 'server',
  [A.ChannelCreate]: 'channels',
  [A.ChannelUpdate]: 'channels',
  [A.ChannelDelete]: 'channels',
  [A.ChannelOverwriteCreate]: 'channels',
  [A.ChannelOverwriteUpdate]: 'channels',
  [A.ChannelOverwriteDelete]: 'channels',
  [A.MemberKick]: 'members',
  [A.MemberPrune]: 'members',
  [A.MemberUpdate]: 'members',
  [A.MemberMove]: 'members',
  [A.MemberDisconnect]: 'members',
  [A.BotAdd]: 'members',
  [A.MemberRoleUpdate]: 'memberRoles',
  [A.MemberBanAdd]: 'bans',
  [A.MemberBanRemove]: 'bans',
  [A.RoleCreate]: 'roles',
  [A.RoleUpdate]: 'roles',
  [A.RoleDelete]: 'roles',
  [A.InviteCreate]: 'invites',
  [A.InviteUpdate]: 'invites',
  [A.InviteDelete]: 'invites',
  [A.MessageBulkDelete]: 'messageActions',
  [A.MessagePin]: 'messageActions',
  [A.MessageUnpin]: 'messageActions',
};
/** Recorded every time AutoMod acts on a message — far too noisy for a log channel. */
const SKIPPED = new Set<AuditLogEvent>([A.AutoModerationBlockMessage, A.AutoModerationFlagToChannel, A.AutoModerationUserCommunicationDisabled]);

export function auditCategory(action: AuditLogEvent): LogEvent | null {
  if (action === A.MessageDelete || SKIPPED.has(action)) return null;
  return CATEGORY[action] ?? 'other';
}

const TITLES: Partial<Record<AuditLogEvent, string>> = {
  [A.GuildUpdate]: 'Server settings changed',
  [A.ChannelCreate]: 'Channel created',
  [A.ChannelUpdate]: 'Channel edited',
  [A.ChannelDelete]: 'Channel deleted',
  [A.ChannelOverwriteCreate]: 'Channel permissions changed',
  [A.ChannelOverwriteUpdate]: 'Channel permissions changed',
  [A.ChannelOverwriteDelete]: 'Channel permissions removed',
  [A.MemberKick]: 'Member kicked',
  [A.MemberPrune]: 'Members pruned',
  [A.MemberBanAdd]: 'Member banned',
  [A.MemberBanRemove]: 'Member unbanned',
  [A.MemberUpdate]: 'Member edited',
  [A.MemberRoleUpdate]: 'Roles changed',
  [A.MemberMove]: 'Moved in voice',
  [A.MemberDisconnect]: 'Disconnected from voice',
  [A.BotAdd]: 'Bot added',
  [A.RoleCreate]: 'Role created',
  [A.RoleUpdate]: 'Role edited',
  [A.RoleDelete]: 'Role deleted',
  [A.InviteCreate]: 'Invite created',
  [A.InviteUpdate]: 'Invite edited',
  [A.InviteDelete]: 'Invite deleted',
  [A.WebhookCreate]: 'Webhook created',
  [A.WebhookUpdate]: 'Webhook edited',
  [A.WebhookDelete]: 'Webhook deleted',
  [A.EmojiCreate]: 'Emoji added',
  [A.EmojiUpdate]: 'Emoji edited',
  [A.EmojiDelete]: 'Emoji deleted',
  [A.StickerCreate]: 'Sticker added',
  [A.StickerUpdate]: 'Sticker edited',
  [A.StickerDelete]: 'Sticker deleted',
  [A.MessageBulkDelete]: 'Messages bulk-deleted',
  [A.MessagePin]: 'Message pinned',
  [A.MessageUnpin]: 'Message unpinned',
  [A.IntegrationCreate]: 'Integration added',
  [A.IntegrationUpdate]: 'Integration edited',
  [A.IntegrationDelete]: 'Integration removed',
  [A.ThreadCreate]: 'Thread created',
  [A.ThreadUpdate]: 'Thread edited',
  [A.ThreadDelete]: 'Thread deleted',
  [A.GuildScheduledEventCreate]: 'Event created',
  [A.GuildScheduledEventUpdate]: 'Event edited',
  [A.GuildScheduledEventDelete]: 'Event deleted',
  [A.ApplicationCommandPermissionUpdate]: 'Command permissions changed',
  [A.AutoModerationRuleCreate]: 'AutoMod rule created',
  [A.AutoModerationRuleUpdate]: 'AutoMod rule edited',
  [A.AutoModerationRuleDelete]: 'AutoMod rule deleted',
};

const humanize = (s: string) => s.replace(/^\$/, '').replace(/_id$/, '').replace(/[_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

const LABELS: Record<string, string> = {
  nick: 'Nickname',
  communication_disabled_until: 'Timeout',
  rate_limit_per_user: 'Slowmode',
  nsfw: 'Age-restricted',
  user_limit: 'User limit',
  color: 'Colour',
  hoist: 'Shown separately',
  mentionable: 'Anyone can @mention',
  permissions: 'Permissions',
  allow: 'Allowed',
  deny: 'Denied',
  icon_hash: 'Icon',
  avatar_hash: 'Avatar',
  splash_hash: 'Invite background',
  banner_hash: 'Banner',
  parent_id: 'Category',
  inviter_id: 'Created by',
  owner_id: 'Owner',
  max_uses: 'Max uses',
  max_age: 'Expires after (s)',
  deaf: 'Server deafened',
  mute: 'Server muted',
  $add: 'Added',
  $remove: 'Removed',
};
/** Changes nobody needs to read (e.g. dragging channels around changes every position). */
const NOISE = new Set(['position', 'id', 'type', 'flags', 'available', 'guild_id', 'application_id', 'permission_overwrites', 'tags', 'version']);

const permNames = (bits: unknown): string[] => {
  try {
    return new PermissionsBitField(BigInt(String(bits ?? 0))).toArray().map(humanize);
  } catch {
    return [];
  }
};

function show(key: string, v: unknown): string {
  if (v === undefined || v === null || v === '') return '*(none)*';
  if ((key.endsWith('channel_id') || key === 'parent_id') && typeof v === 'string') return `<#${v}>`;
  if ((key === 'inviter_id' || key === 'owner_id') && typeof v === 'string') return `<@${v}>`;
  if (key === 'color' && typeof v === 'number') return `#${v.toString(16).padStart(6, '0')}`;
  if (key === 'rate_limit_per_user' && typeof v === 'number') return v ? `${v}s` : 'off';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string' || typeof v === 'number') return truncate(String(v), 300);
  return truncate(JSON.stringify(v), 300);
}

/** One readable field per change ("Name: general → chat", "Permissions: + Kick Members"), or null for noise. */
export function describeChange(c: { key: string; old?: unknown; new?: unknown }, actionType: string): APIEmbedField | null {
  if (NOISE.has(c.key)) return null;
  const name = LABELS[c.key] ?? humanize(c.key);
  if (c.key === '$add' || c.key === '$remove') {
    const roles = Array.isArray(c.new) ? (c.new as { id: string }[]).map((r) => `<@&${r.id}>`) : [];
    return roles.length ? { name, value: truncate(roles.join(' '), 1000), inline: true } : null;
  }
  if (c.key === 'communication_disabled_until') {
    const until = typeof c.new === 'string' ? Date.parse(c.new) : NaN;
    return { name, value: Number.isNaN(until) ? 'removed' : `until <t:${Math.floor(until / 1000)}:f> (<t:${Math.floor(until / 1000)}:R>)` };
  }
  if (c.key === 'permissions' || c.key === 'allow' || c.key === 'deny') {
    const before = new Set(permNames(c.old));
    const after = permNames(c.new);
    const added = after.filter((p) => !before.has(p));
    const removed = [...before].filter((p) => !after.includes(p));
    if (!added.length && !removed.length) return null;
    return { name, value: truncate([...added.map((p) => `+ ${p}`), ...removed.map((p) => `− ${p}`)].join('\n'), 1000) };
  }
  if (actionType === 'Create') return { name, value: show(c.key, c.new), inline: true };
  if (actionType === 'Delete') return { name, value: show(c.key, c.old), inline: true };
  return { name, value: `${show(c.key, c.old)} → ${show(c.key, c.new)}` };
}

/** DelyForge's moderation commands put "(by Name · ID)" in the reason, so the log can name the real moderator. */
const VIA_DELYFORGE = /\s*\(by ([^()]+?) · (\d{17,20})\)$/;

export function whoDidIt(e: Pick<AuditLike, 'executorId' | 'reason'>, botId: string): { by: string; reason: string | null } {
  if (!e.executorId) return { by: 'Discord', reason: e.reason };
  if (e.executorId === botId) {
    const m = e.reason ? VIA_DELYFORGE.exec(e.reason) : null;
    if (m) return { by: `<@${m[2]}> (using DelyForge)`, reason: e.reason!.replace(VIA_DELYFORGE, '') || null };
    return { by: `<@${botId}> (DelyForge, automatic)`, reason: e.reason };
  }
  return { by: `<@${e.executorId}>`, reason: e.reason };
}

const idOf = (v: unknown): string | null => (v && typeof v === 'object' && 'id' in v && typeof v.id === 'string' ? v.id : null);
const num = (extra: unknown, key: string): string => String((extra as Record<string, unknown> | null)?.[key] ?? '?');

/** What the entry is about, as a mention or name. */
function subject(e: AuditLike, isRole: (id: string) => boolean): string {
  const nameChange = e.changes.find((c) => c.key === 'name');
  const name = (nameChange?.new ?? nameChange?.old) as string | undefined;
  const id = e.targetId;
  switch (e.action) {
    case A.MemberMove:
      return `${num(e.extra, 'count')} member(s) moved to <#${idOf((e.extra as { channel?: unknown } | null)?.channel)}>`;
    case A.MemberDisconnect:
      return `${num(e.extra, 'count')} member(s) disconnected`;
    case A.MemberPrune:
      return `${num(e.extra, 'removed')} members inactive for ${num(e.extra, 'days')} days`;
    case A.MessageBulkDelete:
      return `${num(e.extra, 'count')} messages in <#${id}>`;
    case A.MessagePin:
    case A.MessageUnpin:
      return `A message by <@${id}> in <#${idOf((e.extra as { channel?: unknown } | null)?.channel)}>`;
    case A.ChannelOverwriteCreate:
    case A.ChannelOverwriteUpdate:
    case A.ChannelOverwriteDelete: {
      const who = idOf(e.extra);
      return `<#${id}> for ${who ? (isRole(who) ? `<@&${who}>` : `<@${who}>`) : 'someone'}`;
    }
  }
  switch (e.targetType) {
    case 'User':
      return id ? `<@${id}>` : 'Someone';
    case 'Channel':
    case 'Thread':
      return e.actionType === 'Delete' ? `#${name ?? id}` : `<#${id}>`;
    case 'Role':
      return e.actionType === 'Delete' ? `@${name ?? id}` : `<@&${id}>`;
    case 'Guild':
      return 'The server';
    case 'Invite': {
      const code = e.changes.find((c) => c.key === 'code');
      return `discord.gg/${String(code?.new ?? code?.old ?? '?')}`;
    }
    default:
      return name ? `“${name}”` : id ? `ID ${id}` : '';
  }
}

/** The log message for one audit entry, or null when there is nothing worth showing. */
export function auditEmbed(e: AuditLike, botId: string, isRole: (id: string) => boolean): APIEmbed | null {
  const fields = e.changes.map((c) => describeChange(c, e.actionType)).filter((f): f is APIEmbedField => f !== null);
  // An edit whose only changes are noise (e.g. channel positions) isn't worth a message.
  if (e.actionType === 'Update' && e.changes.length && !fields.length) return null;
  let title = TITLES[e.action] ?? humanize(A[e.action] ?? 'Change');
  if (e.action === A.MemberUpdate) {
    const timeout = e.changes.find((c) => c.key === 'communication_disabled_until');
    if (timeout) title = timeout.new ? 'Member timed out' : 'Timeout removed';
    else if (e.changes.every((c) => c.key === 'nick')) title = 'Nickname changed';
  }
  const { by, reason } = whoDidIt(e, botId);
  const color =
    e.action === A.MemberBanAdd || e.action === A.MemberKick || e.actionType === 'Delete' ? COLORS.danger : e.actionType === 'Create' || e.action === A.MemberBanRemove ? COLORS.success : COLORS.warn;
  return {
    title,
    description: `${subject(e, isRole)}\n**By:** ${by}`,
    fields: [...fields.slice(0, 20), ...(reason ? [{ name: 'Reason', value: truncate(reason, 1000) }] : [])],
    color,
    footer: { text: [e.targetId ? `Target ${e.targetId}` : '', e.executorId ? `By ${e.executorId}` : ''].filter(Boolean).join(' · ') || 'Audit log' },
  };
}

export async function onAuditEntry(ctx: ModuleContext, e: AuditLike, guild: Guild): Promise<void> {
  if (e.action === A.MessageDelete) {
    const channelId = idOf((e.extra as { channel?: unknown } | null)?.channel);
    if (e.executorId && e.targetId && channelId) rememberDelete(guild.id, { executorId: e.executorId, targetId: e.targetId, channelId });
    return;
  }
  const category = auditCategory(e.action);
  if (!category) return;
  const embed = auditEmbed(e, ctx.client.user.id, (id) => guild.roles.cache.has(id));
  if (embed) await post(ctx, guild, category, embed);
}
