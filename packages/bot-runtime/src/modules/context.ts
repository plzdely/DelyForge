import type { LogLevel, ModuleConfigs } from '@delyforge/shared';
import {
  type APIEmbed,
  type Client,
  type Guild,
  type GuildMember,
  type MessageCreateOptions,
  PermissionFlagsBits,
  type User,
} from 'discord.js';
import type { BotStore } from '../store.js';

export interface ModuleContext {
  client: Client<true>;
  store: BotStore;
  log(level: LogLevel, message: string): void;
  command(name: string, ok: boolean, durationMs: number): void;
  workflowRun(run: { workflowId: string; ok: boolean; steps: number; message: string }): void;
  /** Resolved settings (defaults filled in) for a server. */
  config(guildId: string): ModuleConfigs;
}

/** Never ping @everyone, @here or roles from templates — only the users actually mentioned. */
export const SAFE_MENTIONS: MessageCreateOptions['allowedMentions'] = { parse: ['users'] };

export const BRAND_COLOR = 0x7c5cff;
export const COLORS = { info: 0x4c8dff, success: 0x3dd68c, warn: 0xf5a524, danger: 0xf04d5e, brand: BRAND_COLOR } as const;

export function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

export function templateVars(member: GuildMember | { user: User; guild: Guild; displayName: string }) {
  return {
    user: `<@${member.user.id}>`,
    'user.name': member.displayName,
    'user.id': member.user.id,
    server: member.guild.name,
    memberCount: member.guild.memberCount,
    'user.created': `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
    'user.joined': 'joinedTimestamp' in member && member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'just now',
    boosts: member.guild.premiumSubscriptionCount ?? 0,
  };
}

/** Resolves a text channel the bot can post in, or null (with a log line explaining why). */
export async function sendableChannel(ctx: ModuleContext, guild: Guild, channelId: string | null, purpose: string) {
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || !channel.isTextBased()) {
    ctx.log('warn', `${purpose}: the selected channel no longer exists in “${guild.name}”.`);
    return null;
  }
  const me = guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    ctx.log('warn', `${purpose}: missing permission to send messages in #${channel.name} (“${guild.name}”).`);
    return null;
  }
  return channel;
}

/** Posts a moderation record to the moderation log channel, if one is set. */
export async function modLog(ctx: ModuleContext, guild: Guild, embed: APIEmbed): Promise<void> {
  const channel = await sendableChannel(ctx, guild, ctx.config(guild.id).moderation.logChannelId, 'Moderation log');
  if (!channel) return;
  await channel.send({ embeds: [{ ...embed, timestamp: new Date().toISOString() }], allowedMentions: { parse: [] } }).catch((e: Error) => {
    ctx.log('warn', `Could not write to the moderation log: ${e.message}`);
  });
}

/** Sends a DM; members can block DMs, which is not an error. */
export async function tryDM(user: User, content: string): Promise<boolean> {
  try {
    await user.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
