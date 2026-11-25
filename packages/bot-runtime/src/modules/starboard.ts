import type { StarboardConfig } from '@delyforge/shared';
import { ChannelType, type GuildBasedChannel, type GuildMember, type Message, type MessageReaction, OverwriteType, type PartialMessageReaction, PermissionFlagsBits, type Role } from 'discord.js';
import { type ModuleContext, sendableChannel, truncate } from './context.js';

/** Does a reaction's emoji match the configured one (a normal emoji like ⭐, or a server emoji written <:name:id>)? */
export function emojiMatches(configured: string, emoji: { id: string | null; name: string | null }): boolean {
  const custom = /^<a?:\w+:(\d+)>$/.exec(configured.trim());
  return custom ? emoji.id === custom[1] : emoji.id === null && emoji.name === configured.trim();
}

/** True when everyone who can see the starboard can also see the source: every viewer of A must be a viewer of B. */
export function audienceFits<T>(viewers: readonly T[], canSeeBoard: (v: T) => boolean, canSeeSource: (v: T) => boolean): boolean {
  return viewers.every((v) => !canSeeBoard(v) || canSeeSource(v));
}

const canView = (ch: GuildBasedChannel, who: Role | GuildMember) => ch.permissionsFor(who)?.has(PermissionFlagsBits.ViewChannel) ?? false;
const isNsfw = (ch: GuildBasedChannel | null) => Boolean(ch && 'nsfw' in ch && ch.nsfw);

/**
 * Never copy a message somewhere more people can see it (e.g. a staff channel into a members' starboard): every role —
 * and every member given their own access to the starboard — must be able to see the original channel too. Private
 * threads are never copied; age-restricted messages only go to an age-restricted starboard.
 */
function mayShowcase(source: GuildBasedChannel, board: GuildBasedChannel): boolean {
  if (source.type === ChannelType.PrivateThread) return false;
  const nsfw = isNsfw(source.isThread() ? source.parent : source);
  if (nsfw && !isNsfw(board)) return false;
  if (!audienceFits([...source.guild.roles.cache.values()], (r) => canView(board, r), (r) => canView(source, r))) return false;
  const memberGrants = 'permissionOverwrites' in board ? board.permissionOverwrites.cache.filter((o) => o.type === OverwriteType.Member && o.allow.has(PermissionFlagsBits.ViewChannel)) : null;
  // A member we can't look up is treated as unable to see the source (refuse rather than guess).
  return !memberGrants || memberGrants.every((o) => {
    const m = source.guild.members.cache.get(o.id);
    return Boolean(m && canView(source, m));
  });
}

/** One update at a time per message, so a burst of reactions can't post it twice. */
const queues = new Map<string, Promise<void>>();
function serial(key: string, fn: () => Promise<void>): Promise<void> {
  const next = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
  queues.set(key, next);
  void next.finally(() => queues.get(key) === next && queues.delete(key));
  return next;
}

export async function onReaction(ctx: ModuleContext, reaction: MessageReaction | PartialMessageReaction): Promise<void> {
  const r = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
  if (!r) return;
  const message = r.message.partial ? await r.message.fetch().catch(() => null) : r.message;
  if (!message?.inGuild() || message.author.bot) return;
  const config = ctx.config(message.guild.id).starboard;
  if (!config.enabled || !config.channelId || !emojiMatches(config.emoji, r.emoji)) return;
  if (message.channelId === config.channelId || config.ignoredChannelIds.includes(message.channelId)) return;
  const board = message.guild.channels.cache.get(config.channelId);
  if (!board || !mayShowcase(message.channel, board)) {
    // No longer allowed (e.g. the channel became private): take down a copy posted earlier.
    const old = ctx.store.starPost(message.guild.id, message.id);
    if (old && board?.isTextBased()) await board.messages.delete(old).catch(() => null);
    if (old) ctx.store.setStarPost(message.guild.id, message.id, null);
    return;
  }
  await serial(message.id, () => sync(ctx, message, config));
}

async function sync(ctx: ModuleContext, message: Message<true>, config: StarboardConfig): Promise<void> {
  const r = message.reactions.cache.find((x) => emojiMatches(config.emoji, x.emoji));
  let count = r?.count ?? 0;
  if (r && count && !config.selfStar) {
    const users = await r.users.fetch().catch(() => null);
    if (users?.has(message.author.id)) count -= 1;
  }
  const existing = ctx.store.starPost(message.guild.id, message.id);
  const channel = await sendableChannel(ctx, message.guild, config.channelId, 'Starboard');
  if (!channel) return;

  if (count < config.threshold) {
    // Dropped below the threshold: take it off the starboard.
    if (existing) await channel.messages.delete(existing).catch(() => null);
    ctx.store.setStarPost(message.guild.id, message.id, null);
    return;
  }
  const image = message.attachments.find((a) => a.contentType?.startsWith('image/'))?.url ?? message.embeds.find((e) => e.image)?.image?.url;
  const payload = {
    content: `${config.emoji} **${count}** · <#${message.channelId}>`,
    embeds: [
      {
        author: { name: message.member?.displayName ?? message.author.username, icon_url: message.author.displayAvatarURL({ size: 64 }) },
        description: `${message.content ? truncate(message.content, 3900) : ''}\n\n[Jump to message](${message.url})`,
        ...(image ? { image: { url: image } } : {}),
        color: 0xf5a524,
        timestamp: message.createdAt.toISOString(),
        footer: { text: message.id },
      },
    ],
    allowedMentions: { parse: [] as const },
  };
  const post = existing ? await channel.messages.fetch(existing).catch(() => null) : null;
  if (post) {
    await post.edit(payload).catch((e: Error) => ctx.log('warn', `Starboard: could not update a post: ${e.message}`));
    return;
  }
  const sent = await channel.send(payload).catch((e: Error) => {
    ctx.log('warn', `Starboard: could not post: ${e.message}`);
    return null;
  });
  if (sent) ctx.store.setStarPost(message.guild.id, message.id, sent.id);
}
