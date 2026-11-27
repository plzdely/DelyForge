import { type ButtonInteraction, ButtonStyle, type ChatInputCommandInteraction, ComponentType, type Guild, MessageFlags, type ModalSubmitInteraction, TextInputStyle } from 'discord.js';
import { COLORS, type ModuleContext, hexToInt, sendableChannel, truncate } from './context.js';

/**
 * Confessions: posted without a name. Staff can still see who wrote each one in the (optional) log channel, so
 * abuse can be dealt with — members are told this when they confess.
 */

export const CONFESS_CID = { reply: (id: number) => `df:conf:reply:${id}`, replyForm: (id: number) => `df:conf:form:${id}`, approve: (id: number) => `df:conf:ok:${id}`, deny: (id: number) => `df:conf:no:${id}` } as const;

type Reply = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
const ephemeral = (i: Reply, content: string) => (i.replied || i.deferred ? i.editReply({ content }) : i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }));

async function post(ctx: ModuleContext, guild: Guild, c: { id: number; number: number; text: string; image: string | null }): Promise<string | null> {
  const cfg = ctx.config(guild.id).confessions;
  const channel = await sendableChannel(ctx, guild, cfg.channelId, 'Confessions');
  if (!channel) return null;
  const msg = await channel
    .send({
      embeds: [{ title: `${cfg.title} #${c.number}`, description: c.text, image: c.image ? { url: c.image } : undefined, color: hexToInt(cfg.color), timestamp: new Date().toISOString() }],
      components: cfg.replies ? [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Reply anonymously', emoji: { name: '💬' }, custom_id: CONFESS_CID.reply(c.id) }] }] : [],
      allowedMentions: { parse: [] },
    })
    .catch(() => null);
  return msg?.url ?? null;
}

async function staffLog(ctx: ModuleContext, guild: Guild, title: string, userId: string, text: string): Promise<void> {
  const channel = await sendableChannel(ctx, guild, ctx.config(guild.id).confessions.logChannelId, 'Confession log');
  await channel?.send({ embeds: [{ title, description: `By <@${userId}> (${userId})\n>>> ${truncate(text, 1500)}`, color: COLORS.info, timestamp: new Date().toISOString() }], allowedMentions: { parse: [] } }).catch(() => null);
}

/** /confess and /confessions ban | unban */
export async function handleConfessCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const cfg = ctx.config(i.guildId).confessions;
  if (!cfg.enabled || !cfg.channelId) return void (await ephemeral(i, 'Confessions aren’t set up in this server.'));
  if (i.commandName === 'confessions') {
    if (!i.member.permissions.has('ManageMessages')) return void (await ephemeral(i, 'Only staff can do that.'));
    const user = i.options.getUser('member', true);
    const ban = i.options.getSubcommand() === 'ban';
    ctx.store.setConfessionBanned(i.guildId, user.id, ban);
    return void (await ephemeral(i, ban ? `🚫 <@${user.id}> can’t confess any more.` : `✅ <@${user.id}> can confess again.`));
  }
  if (ctx.store.confessionBanned(i.guildId, i.user.id)) return void (await ephemeral(i, 'You can’t post confessions in this server.'));
  const last = ctx.store.lastConfessionAt(i.guildId, i.user.id);
  if (cfg.cooldownMinutes && last && Date.now() - last < cfg.cooldownMinutes * 60_000) return void (await ephemeral(i, `You can confess again <t:${Math.floor((last + cfg.cooldownMinutes * 60_000) / 1000)}:R>.`));
  const text = truncate(i.options.getString('message', true).trim(), 1500);
  const attachment = i.options.getAttachment('image');
  const image = attachment?.contentType?.startsWith('image/') ? attachment.url : null;
  const privacy = cfg.logChannelId ? ' Staff can see who sent it, to deal with abuse.' : '';

  if (cfg.reviewChannelId) {
    const review = await sendableChannel(ctx, i.guild, cfg.reviewChannelId, 'Confession review');
    if (!review) return void (await ephemeral(i, 'Confessions can’t be received right now.'));
    const { id } = ctx.store.addConfession(i.guildId, i.user.id, text, image, 'pending', Date.now());
    await review.send({
      embeds: [{ title: 'Confession waiting for approval', description: text, image: image ? { url: image } : undefined, color: COLORS.warn, footer: { text: `#${id}` } }],
      components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Success, label: 'Post it', custom_id: CONFESS_CID.approve(id) }, { type: ComponentType.Button, style: ButtonStyle.Danger, label: 'Reject', custom_id: CONFESS_CID.deny(id) }] }],
      allowedMentions: { parse: [] },
    });
    await staffLog(ctx, i.guild, `Confession #${id} submitted`, i.user.id, text);
    return void (await ephemeral(i, `📨 Sent for approval — it’s posted without your name once staff OK it.${privacy}`));
  }
  const { id, number } = ctx.store.addConfession(i.guildId, i.user.id, text, image, 'posted', Date.now());
  const url = await post(ctx, i.guild, { id, number: number!, text, image });
  if (!url) return void (await ephemeral(i, 'I couldn’t post it — please tell staff.'));
  await staffLog(ctx, i.guild, `Confession #${number}`, i.user.id, text);
  await ephemeral(i, `🤫 Posted anonymously: ${url}${privacy}`);
}

/** Staff approve or reject a waiting confession. */
export async function onConfessionDecision(ctx: ModuleContext, i: ButtonInteraction, id: number, approve: boolean): Promise<void> {
  if (!i.inCachedGuild()) return;
  if (!i.member.permissions.has('ManageMessages')) return void (await ephemeral(i, 'Only staff can decide confessions.'));
  const c = ctx.store.confession(id);
  if (!c || c.guildId !== i.guildId) return void (await ephemeral(i, 'That confession no longer exists.'));
  const number = ctx.store.decideConfession(id, approve);
  if (number === false) return void (await ephemeral(i, 'Someone already decided this one.'));
  const url = approve ? await post(ctx, i.guild, { id, number: number!, text: c.text, image: c.image }) : null;
  await i.update({ embeds: [{ title: approve ? `✅ Posted as #${number}` : '❌ Rejected', description: c.text, color: approve ? COLORS.success : COLORS.danger, footer: { text: `by staff ${i.user.tag}` } }], components: [] });
  if (approve && !url) ctx.log('warn', 'Confessions: an approved confession couldn’t be posted (check the channel and my permissions).');
}

/** "Reply anonymously" button → a short form → posted in a thread under the confession. */
export async function onConfessionReplyButton(ctx: ModuleContext, i: ButtonInteraction, id: number): Promise<void> {
  if (!i.inCachedGuild()) return;
  if (ctx.store.confessionBanned(i.guildId, i.user.id)) return void (await ephemeral(i, 'You can’t post here.'));
  await i.showModal({ title: 'Anonymous reply', custom_id: CONFESS_CID.replyForm(id), components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.TextInput, custom_id: 'text', label: 'Your reply', style: TextInputStyle.Paragraph, required: true, max_length: 1000 }] }] });
}

const lastReply = new Map<string, number>();
export async function onConfessionReply(ctx: ModuleContext, i: ModalSubmitInteraction, id: number): Promise<void> {
  if (!i.inCachedGuild() || !i.message) return;
  const key = `${i.guildId}:${i.user.id}`;
  if (Date.now() - (lastReply.get(key) ?? 0) < 30_000) return void (await ephemeral(i, 'Slow down — one anonymous reply every 30 seconds.'));
  lastReply.set(key, Date.now());
  const text = truncate(i.fields.getTextInputValue('text').trim(), 1000);
  const message = i.message;
  const thread = message.thread ?? (await message.startThread({ name: truncate(`Replies to ${message.embeds[0]?.title ?? 'confession'}`, 100) }).catch(() => null));
  if (!thread) return void (await ephemeral(i, 'I couldn’t open the reply thread (I need Create Public Threads).'));
  await thread.send({ embeds: [{ description: text, color: hexToInt(ctx.config(i.guildId).confessions.color), footer: { text: 'Anonymous reply' } }], allowedMentions: { parse: [] } });
  await staffLog(ctx, i.guild, `Anonymous reply to confession ${id}`, i.user.id, text);
  await ephemeral(i, '💬 Reply posted anonymously.');
}
