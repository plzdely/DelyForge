import type { LogEvent } from '@delyforge/shared';
import {
  type APIEmbed,
  AuditLogEvent,
  type Guild,
  type GuildBan,
  type GuildMember,
  type Message,
  type NonThreadGuildBasedChannel,
  type PartialGuildMember,
  type PartialMessage,
  type VoiceState,
} from 'discord.js';
import { COLORS, type ModuleContext, sendableChannel, truncate } from './context.js';

async function post(ctx: ModuleContext, guild: Guild, event: LogEvent, embed: APIEmbed, sourceChannelId?: string): Promise<void> {
  const config = ctx.config(guild.id).logging;
  if (!config.enabled || !config.events[event]) return;
  if (sourceChannelId && (sourceChannelId === config.channelId || config.ignoredChannelIds.includes(sourceChannelId))) return;
  const channel = await sendableChannel(ctx, guild, config.channelId, 'Logging');
  if (!channel) return;
  await channel
    .send({ embeds: [{ ...embed, timestamp: new Date().toISOString() }], allowedMentions: { parse: [] } })
    .catch((e: Error) => ctx.log('warn', `Logging: could not post: ${e.message}`));
}

const content = (text: string | null | undefined) => (text ? truncate(text, 1000) : '*(content unavailable — the message was sent before the bot started, or Message Content intent is off)*');

export async function onMessageDelete(ctx: ModuleContext, message: Message | PartialMessage): Promise<void> {
  if (!message.guild || message.author?.bot) return;
  await post(
    ctx,
    message.guild,
    'messageDelete',
    {
      title: 'Message deleted',
      description: `${message.author ? `<@${message.author.id}>` : 'Unknown author'} in <#${message.channelId}>\n>>> ${content(message.content)}`,
      color: COLORS.danger,
    },
    message.channelId,
  );
}

export async function onMessageEdit(ctx: ModuleContext, before: Message | PartialMessage, after: Message | PartialMessage): Promise<void> {
  if (!after.guild || after.author?.bot || before.content === after.content) return;
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
    },
    after.channelId,
  );
}

export async function onMemberJoinLog(ctx: ModuleContext, member: GuildMember): Promise<void> {
  const age = Math.floor(member.user.createdTimestamp / 1000);
  await post(ctx, member.guild, 'memberJoin', {
    title: 'Member joined',
    description: `<@${member.id}> (${member.user.tag})\nAccount created <t:${age}:R>`,
    color: COLORS.success,
    thumbnail: { url: member.user.displayAvatarURL({ size: 128 }) },
  });
}

export async function onMemberLeaveLog(ctx: ModuleContext, member: GuildMember | PartialGuildMember): Promise<void> {
  await post(ctx, member.guild, 'memberLeave', {
    title: 'Member left',
    description: `<@${member.id}> (${member.user?.tag ?? member.id})`,
    color: COLORS.danger,
  });
}

export async function onMemberUpdateLog(ctx: ModuleContext, before: GuildMember | PartialGuildMember, after: GuildMember): Promise<void> {
  if (before.partial) return;
  const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
  const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
  if (!added.size && !removed.size) return;
  await post(ctx, after.guild, 'memberRoles', {
    title: 'Roles changed',
    description: `<@${after.id}>${added.size ? `\n**Added:** ${added.map((r) => `<@&${r.id}>`).join(' ')}` : ''}${removed.size ? `\n**Removed:** ${removed.map((r) => `<@&${r.id}>`).join(' ')}` : ''}`,
    color: COLORS.info,
  });
}

export async function onChannelChange(ctx: ModuleContext, channel: NonThreadGuildBasedChannel, change: 'created' | 'deleted'): Promise<void> {
  await post(ctx, channel.guild, 'channels', {
    title: `Channel ${change}`,
    description: change === 'created' ? `<#${channel.id}> (${channel.name})` : `#${channel.name}`,
    color: change === 'created' ? COLORS.success : COLORS.danger,
  });
}

export async function onBan(ctx: ModuleContext, ban: GuildBan, change: 'banned' | 'unbanned'): Promise<void> {
  let by = '';
  if (change === 'banned') {
    // Who did it, if the bot can read the audit log.
    const logs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 3 }).catch(() => null);
    const entry = logs?.entries.find((e) => e.targetId === ban.user.id);
    if (entry?.executorId) by = ` by <@${entry.executorId}>`;
  }
  await post(ctx, ban.guild, 'bans', {
    title: change === 'banned' ? 'Member banned' : 'Member unbanned',
    description: `<@${ban.user.id}> (${ban.user.tag})${by}${ban.reason ? `\n**Reason:** ${truncate(ban.reason, 400)}` : ''}`,
    color: change === 'banned' ? COLORS.danger : COLORS.success,
  });
}

export async function onVoice(ctx: ModuleContext, before: VoiceState, after: VoiceState): Promise<void> {
  if (before.channelId === after.channelId || after.member?.user.bot) return;
  const who = `<@${after.id}>`;
  const description =
    !before.channelId ? `${who} joined <#${after.channelId}>` : !after.channelId ? `${who} left <#${before.channelId}>` : `${who} moved <#${before.channelId}> → <#${after.channelId}>`;
  await post(ctx, after.guild, 'voice', { title: 'Voice', description, color: COLORS.info });
}
