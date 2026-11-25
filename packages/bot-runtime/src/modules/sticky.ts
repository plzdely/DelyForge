import type { Message } from 'discord.js';
import { type ModuleContext, hexToInt } from './context.js';

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const key = (channelId: string) => `sticky:${channelId}`;

export function onMessage(ctx: ModuleContext, message: Message): void {
  if (!message.inGuild() || message.author.id === ctx.client.user.id) return;
  const config = ctx.config(message.guild.id).sticky;
  if (!config.enabled || !config.messages.some((m) => m.channelId === message.channelId)) return;
  clearTimeout(timers.get(message.channelId));
  timers.set(
    message.channelId,
    setTimeout(() => {
      timers.delete(message.channelId);
      void repost(ctx, message).catch((e: Error) => ctx.log('warn', `Sticky message: ${e.message}`));
    }, config.quietSeconds * 1000), // wait for a quiet moment, so a busy chat doesn't make the bot post after every message
  );
}

async function repost(ctx: ModuleContext, trigger: Message<true>): Promise<void> {
  const { guild, channel } = trigger;
  const sticky = ctx.config(guild.id).sticky.messages.find((m) => m.channelId === channel.id);
  if (!sticky) return;
  // The previous copy is remembered in the bot's data, so a restart doesn't leave an old one behind.
  const previous = ctx.store.panels(guild.id).find((p) => p.key === key(channel.id));
  if (previous) await channel.messages.delete(previous.messageId).catch(() => null);
  const sent = await channel.send(
    sticky.embed ? { embeds: [{ description: sticky.text, color: hexToInt(sticky.color) }], allowedMentions: { parse: [] } } : { content: sticky.text, allowedMentions: { parse: [] } },
  );
  ctx.store.savePanel(guild.id, key(channel.id), channel.id, sent.id, 'sticky');
}
