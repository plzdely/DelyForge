import type { StarboardConfig } from '@delyforge/shared';
import { ChannelType, type GuildBasedChannel, type Message, type MessageReaction, type PartialMessageReaction, PermissionFlagsBits } from 'discord.js';
import { type ModuleContext, sendableChannel, truncate } from './context.js';

/** Does a reaction's emoji match the configured one (a normal emoji like ⭐, or a server emoji written <:name:id>)? */
export function emojiMatches(configured: string, emoji: { id: string | null; name: string | null }): boolean {
  const custom = /^<a?:\w+:(\d+)>$/.exec(configured.trim());
  return custom ? emoji.id === custom[1] : emoji.id === null && emoji.name === configured.trim();
}

/**
 * Never copy a message somewhere more people can see it: a private (staff) channel's messages may only go to a
 * starboard that is private too, and age-restricted messages only to an age-restricted starboard.
 */
export function mayShowcase(source: { public: boolean; nsfw: boolean }, board: { public: boolean; nsfw: boolean }): boolean {
  return (source.public || !board.public) && (!source.nsfw || board.nsfw);
}

const visibility = (ch: GuildBasedChannel) => ({
  // A private thread inherits its parent's permissions but is invite-only, so it never counts as public.
  public: ch.type !== ChannelType.PrivateThread && (ch.permissionsFor(ch.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) ?? false),
  nsfw: 'nsfw' in ch ? Boolean(ch.nsfw) : false,
});

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
  if (!board || !mayShowcase(visibility(message.channel), visibility(board))) return;
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
