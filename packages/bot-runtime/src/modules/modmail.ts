import {
  AttachmentBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  ComponentType,
  type Guild,
  type Message,
  MessageFlags,
  SnowflakeUtil,
  type StringSelectMenuInteraction,
  type ThreadChannel,
  type User,
} from 'discord.js';
import { COLORS, type ModuleContext, sendableChannel, truncate } from './context.js';
import { isStaff } from './roles.js';

/**
 * Modmail: members DM the bot, staff answer in a thread in a staff-only channel.
 * Messages in the thread starting with // stay between staff.
 */

export const MODMAIL_PICK = 'df:mm:pick';

/** A first DM from someone in several servers waits here while they pick one (forgotten after 10 minutes). */
const waiting = new Map<string, { text: string; files: string[]; at: number }>();

const fileLinks = (m: Message) => [...m.attachments.values()].map((a) => a.url);
const withFiles = (text: string, files: string[]) => truncate([text, ...files].filter(Boolean).join('\n'), 4000) || '(empty message)';

/** A DM to the bot. */
export async function onModmailDM(ctx: ModuleContext, m: Message): Promise<void> {
  if (m.inGuild() || m.author.bot) return;
  const guilds = [...ctx.client.guilds.cache.values()].filter((g) => {
    const c = ctx.config(g.id).modmail;
    return c.enabled && c.channelId;
  });
  if (!guilds.length) return;
  // An open conversation wins: keep talking there.
  const open = guilds.find((g) => ctx.store.openModmail(g.id, m.author.id));
  if (open && ctx.store.modmailBlocked(open.id, m.author.id)) return void (await m.reply(`You can’t use modmail in **${open.name}**.`).catch(() => null));
  if (open) return void (await relayToThread(ctx, open, m.author, m.content, fileLinks(m), m));

  const member = await Promise.all(guilds.map(async (g) => ((await g.members.fetch(m.author.id).catch(() => null)) ? g : null)));
  const mine = member.filter((g): g is Guild => !!g);
  if (!mine.length) return;
  if (mine.length === 1) return void (await startFromDM(ctx, mine[0]!, m.author, m.content, fileLinks(m), m));

  for (const [k, v] of waiting) if (Date.now() - v.at > 600_000) waiting.delete(k);
  waiting.set(m.author.id, { text: m.content, files: fileLinks(m), at: Date.now() });
  await m.reply({
    content: 'Which server’s staff do you want to talk to?',
    components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.StringSelect, custom_id: MODMAIL_PICK, placeholder: 'Pick a server', options: mine.slice(0, 25).map((g) => ({ label: truncate(g.name, 100), value: g.id })) }] }],
  });
}

/** The member picked a server for their first message. */
export async function onModmailPick(ctx: ModuleContext, i: StringSelectMenuInteraction): Promise<void> {
  const pending = waiting.get(i.user.id);
  const guild = ctx.client.guilds.cache.get(i.values[0] ?? '');
  // Only servers the member is actually in (the menu could be replayed with another server's ID).
  const member = guild ? await guild.members.fetch(i.user.id).catch(() => null) : null;
  if (!pending || !guild || !member || !ctx.config(guild.id).modmail.enabled) return void (await i.update({ content: 'That took too long — please send your message again.', components: [] }));
  waiting.delete(i.user.id);
  await i.update({ content: `Sending to **${guild.name}**…`, components: [] });
  await startFromDM(ctx, guild, i.user, pending.text, pending.files, null);
}

async function startFromDM(ctx: ModuleContext, guild: Guild, user: User, text: string, files: string[], m: Message | null): Promise<void> {
  if (ctx.store.modmailBlocked(guild.id, user.id)) {
    await user.send(`You can’t use modmail in **${guild.name}**.`).catch(() => null);
    return;
  }
  const thread = await openThread(ctx, guild, user, null);
  if (!thread) {
    await user.send(`Sorry — I couldn’t reach the staff of **${guild.name}** right now. Please try again later.`).catch(() => null);
    return;
  }
  const c = ctx.config(guild.id).modmail;
  await user.send({ embeds: [{ title: `📬 ${guild.name}`, description: c.greeting, color: COLORS.brand }] }).catch(() => null);
  await relayToThread(ctx, guild, user, text, files, m);
}

/** Creates the staff thread with the member's details. `by` = the staff member who started it (null = the member). */
async function openThread(ctx: ModuleContext, guild: Guild, user: User, by: string | null): Promise<ThreadChannel | null> {
  const c = ctx.config(guild.id).modmail;
  const parent = c.channelId ? guild.channels.cache.get(c.channelId) : null;
  if (!parent || parent.type !== ChannelType.GuildText) {
    ctx.log('warn', `Modmail: the modmail channel in “${guild.name}” is missing or isn’t a text channel.`);
    return null;
  }
  const thread = await parent.threads.create({ name: truncate(`📬 ${user.username}`, 100), autoArchiveDuration: 10080, reason: `Modmail with ${user.tag}` }).catch((e: Error) => {
    ctx.log('warn', `Modmail: could not create a thread: ${e.message}`);
    return null;
  });
  if (!thread) return null;
  ctx.store.addModmail(guild.id, user.id, thread.id, Date.now());
  const member = await guild.members.fetch(user.id).catch(() => null);
  const roles = member?.roles.cache.filter((r) => r.id !== guild.id).map((r) => `<@&${r.id}>`).slice(0, 15).join(' ');
  const staff = c.staffRoleIds.filter((id) => guild.roles.cache.has(id));
  await thread
    .send({
      content: c.pingStaff && staff.length ? staff.map((id) => `<@&${id}>`).join(' ') : undefined,
      embeds: [
        {
          title: by ? 'Conversation started by staff' : 'New modmail',
          description: `<@${user.id}> · ${user.tag} · ${user.id}`,
          thumbnail: { url: user.displayAvatarURL({ size: 128 }) },
          color: COLORS.info,
          fields: [
            { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
            ...(member?.joinedTimestamp ? [{ name: 'Joined', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true }] : []),
            { name: 'Earlier conversations', value: String(ctx.store.modmailCount(guild.id, user.id) - 1), inline: true },
            ...(roles ? [{ name: 'Roles', value: roles }] : []),
            { name: 'How to reply', value: 'Type here and I’ll DM it to them. Start a message with `//` to keep it between staff. `/modmail close` ends it.' },
          ],
        },
      ],
      allowedMentions: { roles: c.pingStaff ? staff : [] },
    })
    .catch(() => null);
  ctx.log('info', `Modmail: conversation with ${user.tag} opened in “${guild.name}”.`);
  return thread;
}

async function relayToThread(ctx: ModuleContext, guild: Guild, user: User, text: string, files: string[], m: Message | null): Promise<void> {
  const threadId = ctx.store.openModmail(guild.id, user.id);
  const thread = threadId ? ((guild.channels.cache.get(threadId) ?? (await guild.channels.fetch(threadId).catch(() => null))) as ThreadChannel | null) : null;
  if (!thread?.isThread()) {
    // The thread was deleted by hand: close the record and start fresh next time.
    if (threadId) ctx.store.closeModmail(threadId);
    await user.send('Your conversation was closed. Send your message again to start a new one.').catch(() => null);
    return;
  }
  if (thread.archived) await thread.setArchived(false).catch(() => null);
  const sent = await thread
    .send({ embeds: [{ author: { name: user.username, icon_url: user.displayAvatarURL({ size: 64 }) }, description: withFiles(text, files), color: COLORS.brand, timestamp: new Date().toISOString() }], allowedMentions: { parse: [] } })
    .catch(() => null);
  if (m) await m.react(sent ? '✅' : '❌').catch(() => null);
}

/** A staff message in a modmail thread: DM it to the member (unless it starts with //). */
export async function onModmailThreadMessage(ctx: ModuleContext, m: Message): Promise<void> {
  if (!m.inGuild() || m.author.bot || !m.channel.isThread()) return;
  const mm = ctx.store.modmailByThread(m.channelId);
  if (!mm?.open || m.content.startsWith('//')) return;
  const c = ctx.config(m.guild.id).modmail;
  if (!c.enabled) return;
  const user = await ctx.client.users.fetch(mm.userId).catch(() => null);
  const author = c.anonymous ? { name: 'Staff Team', icon_url: m.guild.iconURL({ size: 64 }) ?? undefined } : { name: m.member?.displayName ?? m.author.username, icon_url: m.author.displayAvatarURL({ size: 64 }) };
  const sent = user
    ? await user.send({ embeds: [{ author, description: withFiles(m.content, fileLinks(m)), color: COLORS.success, footer: { text: m.guild.name } }] }).catch(() => null)
    : null;
  await m.react(sent ? '✅' : '❌').catch(() => null);
  if (!sent) await m.reply({ content: 'I couldn’t DM them (they left the server or closed their DMs).', allowedMentions: { parse: [] } }).catch(() => null);
}

/** Posts a text transcript of a closed conversation to the modmail log channel (if one is set). */
async function saveTranscript(ctx: ModuleContext, guild: Guild, thread: ThreadChannel, userId: string, why: string): Promise<void> {
  const log = await sendableChannel(ctx, guild, ctx.config(guild.id).modmail.logChannelId, 'Modmail log');
  if (!log) return;
  const msgs = [...((await thread.messages.fetch({ limit: 100 }).catch(() => null))?.values() ?? [])].reverse();
  const lines = msgs.map((m) => `[${m.createdAt.toISOString().slice(0, 19).replace('T', ' ')}] ${m.author.bot ? (m.embeds[0]?.author?.name ?? 'bot') : m.author.tag}: ${m.content || m.embeds[0]?.description || ''}`);
  await log
    .send({ content: `📪 Modmail with <@${userId}> ${why}.`, files: [new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `modmail-${userId}.txt` })], allowedMentions: { parse: [] } })
    .catch(() => null);
}

/** Every 10 minutes: closes conversations nobody wrote in for the configured hours. */
export async function autoCloseModmail(ctx: ModuleContext, guild: Guild, now = Date.now()): Promise<void> {
  const c = ctx.config(guild.id).modmail;
  if (!c.enabled || !c.autoCloseHours) return;
  for (const mm of ctx.store.openModmails(guild.id)) {
    const thread = (guild.channels.cache.get(mm.threadId) ?? (await guild.channels.fetch(mm.threadId).catch(() => null))) as ThreadChannel | null;
    if (!thread?.isThread()) {
      ctx.store.closeModmail(mm.threadId);
      continue;
    }
    const last = thread.lastMessageId ? Number(SnowflakeUtil.timestampFrom(thread.lastMessageId)) : (thread.createdTimestamp ?? now);
    if (now - last < c.autoCloseHours * 3_600_000 || !ctx.store.closeModmail(mm.threadId)) continue;
    const user = await ctx.client.users.fetch(mm.userId).catch(() => null);
    await user?.send({ embeds: [{ title: `📪 ${guild.name}`, description: `${c.closingMessage}\n\n(Closed automatically after ${c.autoCloseHours} hours without messages.)`, color: COLORS.info }] }).catch(() => null);
    await thread.send({ content: `🔒 Closed automatically — no messages for ${c.autoCloseHours} hours.`, allowedMentions: { parse: [] } }).catch(() => null);
    await saveTranscript(ctx, guild, thread, mm.userId, `closed automatically after ${c.autoCloseHours} h`);
    await thread.setLocked(true).catch(() => null);
    await thread.setArchived(true).catch(() => null);
  }
}

const ephemeral = (i: ChatInputCommandInteraction, content: string) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** /modmail open | close | block | unblock */
export async function handleModmailCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).modmail;
  if (!c.enabled) return void (await ephemeral(i, 'Modmail isn’t enabled in this server.'));
  if (!isStaff(i.member, c.staffRoleIds) && !i.member.permissions.has('ManageMessages')) return void (await ephemeral(i, 'Only modmail staff can do that.'));
  const sub = i.options.getSubcommand();

  if (sub === 'snippet') {
    const mm = ctx.store.modmailByThread(i.channelId);
    if (!mm?.open) return void (await ephemeral(i, 'Use this inside an open modmail thread.'));
    const snip = c.snippets.find((s) => s.name === i.options.getString('name', true));
    if (!snip) return void (await ephemeral(i, 'That snippet no longer exists.'));
    const user = await ctx.client.users.fetch(mm.userId).catch(() => null);
    const author = c.anonymous ? { name: 'Staff Team', icon_url: i.guild.iconURL({ size: 64 }) ?? undefined } : { name: i.member.displayName, icon_url: i.user.displayAvatarURL({ size: 64 }) };
    const sent = user ? await user.send({ embeds: [{ author, description: snip.text, color: COLORS.success, footer: { text: i.guild.name } }] }).then(() => true, () => false) : false;
    return void (await i.reply({ content: sent ? `📨 Sent snippet **${snip.name}**:\n>>> ${truncate(snip.text, 1500)}` : 'I couldn’t DM them.', allowedMentions: { parse: [] } }));
  }

  if (sub === 'close') {
    const mm = ctx.store.modmailByThread(i.channelId);
    if (!mm || !i.channel?.isThread()) return void (await ephemeral(i, 'Use this inside a modmail thread.'));
    if (!ctx.store.closeModmail(i.channelId)) return void (await ephemeral(i, 'This conversation is already closed.'));
    const reason = i.options.getString('reason');
    const user = await ctx.client.users.fetch(mm.userId).catch(() => null);
    await user?.send({ embeds: [{ title: `📪 ${i.guild.name}`, description: `${c.closingMessage}${reason ? `\n\n**Reason:** ${reason}` : ''}`, color: COLORS.info }] }).catch(() => null);
    await i.reply({ content: `🔒 Closed by <@${i.user.id}>${reason ? `: ${reason}` : ''}.`, allowedMentions: { parse: [] } });
    await saveTranscript(ctx, i.guild, i.channel, mm.userId, `closed by ${i.user.tag}${reason ? ` — ${reason}` : ''}`);
    await i.channel.setLocked(true).catch(() => null);
    await i.channel.setArchived(true).catch(() => null);
    return;
  }

  const user = i.options.getUser('member', true);
  if (user.bot) return void (await ephemeral(i, 'Bots can’t use modmail.'));
  if (sub === 'block' || sub === 'unblock') {
    ctx.store.setModmailBlocked(i.guildId, user.id, sub === 'block');
    // Blocking also ends a conversation that's open right now.
    const openThread = sub === 'block' ? ctx.store.openModmail(i.guildId, user.id) : null;
    if (openThread && ctx.store.closeModmail(openThread)) {
      const t = i.guild.channels.cache.get(openThread);
      if (t?.isThread()) {
        await t.send({ content: `🚫 Closed: <@${user.id}> was blocked by <@${i.user.id}>.`, allowedMentions: { parse: [] } }).catch(() => null);
        await t.setLocked(true).catch(() => null);
        await t.setArchived(true).catch(() => null);
      }
    }
    return void (await ephemeral(i, sub === 'block' ? `🚫 <@${user.id}> can’t use modmail any more.` : `✅ <@${user.id}> can use modmail again.`));
  }
  // open
  const existing = ctx.store.openModmail(i.guildId, user.id);
  if (existing && i.guild.channels.cache.has(existing)) return void (await ephemeral(i, `There’s already an open conversation: <#${existing}>`));
  if (existing) ctx.store.closeModmail(existing);
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const thread = await openThread(ctx, i.guild, user, i.user.id);
  if (!thread) return void (await i.editReply('I couldn’t create the thread — check the modmail channel in DelyForge and my Create Threads permission.'));
  const dm = await user.send({ embeds: [{ title: `📬 ${i.guild.name}`, description: 'The staff team started a conversation with you. Reply here to answer them.', color: COLORS.brand }] }).then(() => true, () => false);
  await i.editReply(`Opened <#${thread.id}>.${dm ? '' : ' (I couldn’t DM them — their DMs may be closed.)'}`);
}
