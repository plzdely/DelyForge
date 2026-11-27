import { highlightHit } from '@delyforge/shared';
import { type ChatInputCommandInteraction, type Message, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { COLORS, type ModuleContext, truncate } from './context.js';

/** When each member last talked in each channel (they don't need a DM about a chat they're in). */
const lastSpoke = new Map<string, number>();
/** When each member last got a highlight DM (for the cooldown). */
const lastDm = new Map<string, number>();

/** /highlight add | remove | list | clear | ignore */
export async function handleHighlightCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).highlights;
  const say = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (!c.enabled) return void (await say('Highlights aren’t enabled in this server.'));
  const sub = i.options.getSubcommand();
  if (sub === 'list') {
    const words = ctx.store.highlightWords(i.guildId, i.user.id);
    return void (await say(words.length ? `🔔 You get a DM when someone says: ${words.map((w) => `**${w}**`).join(', ')}` : 'You aren’t watching any words. Add one with /highlight add.'));
  }
  if (sub === 'clear') return void (await say(`Stopped watching ${ctx.store.removeHighlight(i.guildId, i.user.id, null)} word(s).`));
  if (sub === 'ignore') {
    const ch = i.options.getChannel('channel', true);
    return void (await say(ctx.store.toggleHighlightIgnore(i.guildId, i.user.id, ch.id) ? `No highlights from <#${ch.id}> any more.` : `Highlights from <#${ch.id}> are back on.`));
  }
  const word = i.options.getString('word', true).trim().toLowerCase();
  if (sub === 'remove') return void (await say(ctx.store.removeHighlight(i.guildId, i.user.id, word) ? `Stopped watching **${word}**.` : `You weren’t watching **${word}**.`));
  if (word.length < 2) return void (await say('Words need at least 2 letters.'));
  if (ctx.store.highlightWords(i.guildId, i.user.id).length >= c.maxWords) return void (await say(`You can watch up to ${c.maxWords} words — remove one first.`));
  await say(ctx.store.addHighlight(i.guildId, i.user.id, word) ? `🔔 I’ll DM you when someone says **${word}** (in channels you can see).` : `You’re already watching **${word}**.`);
}

/** Checks a message for everyone's watched words and DMs them a link with the conversation around it. */
export async function onHighlightMessage(ctx: ModuleContext, m: Message): Promise<void> {
  if (!m.inGuild() || m.author.bot || !m.content) return;
  const now = Date.now();
  lastSpoke.set(`${m.channelId}:${m.author.id}`, now);
  if (lastSpoke.size > 20_000) lastSpoke.clear();
  const c = ctx.config(m.guild.id).highlights;
  if (!c.enabled) return;
  const channelId = m.channel.isThread() ? (m.channel.parentId ?? m.channelId) : m.channelId;
  if (c.ignoredChannelIds.includes(channelId)) return;
  const words = ctx.store.allHighlights(m.guild.id);
  const notified = new Set<string>();
  for (const [word, userIds] of words) {
    if (!highlightHit(m.content, word)) continue;
    for (const userId of userIds) {
      if (userId === m.author.id || notified.has(userId)) continue;
      // Not if they were talking here in the last 5 minutes, or are on cooldown, or ignore this channel.
      if (now - (lastSpoke.get(`${m.channelId}:${userId}`) ?? 0) < 300_000) continue;
      if (now - (lastDm.get(`${m.guild.id}:${userId}`) ?? 0) < c.cooldownMinutes * 60_000) continue;
      if (ctx.store.highlightIgnored(m.guild.id, userId, channelId) || ctx.store.highlightIgnored(m.guild.id, userId, m.channelId)) continue;
      const member = await m.guild.members.fetch(userId).catch(() => null);
      // Only channels they can actually read.
      if (!member || !m.channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) continue;
      notified.add(userId);
      lastDm.set(`${m.guild.id}:${userId}`, now);
      const before = await m.channel.messages.fetch({ before: m.id, limit: 3 }).catch(() => null);
      const context = [...(before?.values() ?? [])].reverse().map((x) => `**${x.member?.displayName ?? x.author.username}:** ${truncate(x.content || '(attachment)', 150)}`);
      await member
        .send({
          embeds: [
            {
              title: `🔔 “${word}” in #${'name' in m.channel ? m.channel.name : 'a channel'}`,
              description: [...context, `**${m.member?.displayName ?? m.author.username}:** ${truncate(m.content, 400)}`, '', `[Jump to the message](${m.url})`].join('\n'),
              color: COLORS.brand,
              footer: { text: `${m.guild.name} · /highlight to change your words` },
              timestamp: new Date().toISOString(),
            },
          ],
        })
        .catch(() => null);
    }
  }
}
