import { type TicketsConfig, renderTemplate } from '@delyforge/shared';
import {
  AttachmentBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  ComponentType,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  MessageFlags,
  type ModalSubmitInteraction,
  OverwriteType,
  PermissionFlagsBits,
  Role,
  SnowflakeUtil,
  TextInputStyle,
} from 'discord.js';
import { COLORS, type ModuleContext, hexToInt, sendableChannel, truncate } from './context.js';
import { CID } from './panels.js';
import { isStaff } from './roles.js';

export const TICKET_COMMANDS = new Set(['ticket']);

const P = PermissionFlagsBits;
const MEMBER_ACCESS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

const slug = (text: string, max: number) => text.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, max);

/** "Dely 🎮!" → "dely" — keeps ticket channel names valid and readable. Extra panels use their own name as prefix. */
export function ticketChannelName(username: string, n: number, prefix = 'ticket'): string {
  return `${slug(prefix, 20) || 'ticket'}-${n}-${slug(username, 20) || 'member'}`;
}

/** What a ticket opened from a panel gets: the main panel's settings, or an extra panel's (null = panel removed). */
export function ticketKind(c: TicketsConfig, panelId: string | null) {
  if (!panelId) return { panelId: null, prefix: 'ticket', categoryId: c.categoryId, staffRoleIds: c.staffRoleIds, openMessage: c.openMessage, color: c.panel.color, pingStaff: c.pingStaff };
  const p = c.extraPanels.find((x) => x.id === panelId);
  if (!p) return null;
  return {
    panelId: p.id,
    prefix: p.name,
    categoryId: p.categoryId ?? c.categoryId,
    // The main staff roles see every ticket; each panel can add its own.
    staffRoleIds: [...new Set([...c.staffRoleIds, ...p.staffRoleIds])],
    openMessage: p.openMessage,
    color: p.panel.color,
    pingStaff: p.pingStaff,
  };
}

/** Plain-text transcript of a ticket, oldest message first. */
export function formatTranscript(channelName: string, messages: readonly { at: Date; author: string; content: string; attachments: string[] }[]): string {
  const lines = messages.map((m) => {
    const files = m.attachments.length ? ` [files: ${m.attachments.join(', ')}]` : '';
    return `[${m.at.toISOString().replace('T', ' ').slice(0, 19)}] ${m.author}: ${m.content}${files}`;
  });
  return `Transcript of #${channelName} — ${messages.length} message(s)\n\n${lines.join('\n')}\n`;
}

/** True when a ticket had no messages for `hours` (the last message, or the opening time if it has none). */
export function ticketIsIdle(lastActivityMs: number, hours: number, now: number): boolean {
  return hours > 0 && now - lastActivityMs >= hours * 3_600_000;
}

type Reply = ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction;
const reply = (i: Reply, content: string) =>
  i.replied || i.deferred
    ? i.editReply({ content, allowedMentions: { parse: [] } })
    : i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** Posts a ticket event (opened, claimed, closed, rated) to the ticket log channel, if one is set. */
async function ticketLog(ctx: ModuleContext, guild: Guild, embed: { title: string; description: string; color: number }): Promise<void> {
  const channel = await sendableChannel(ctx, guild, ctx.config(guild.id).tickets.logChannelId, 'Ticket log');
  await channel?.send({ embeds: [{ ...embed, timestamp: new Date().toISOString() }], allowedMentions: { parse: [] } }).catch(() => null);
}

/** "🔴-ticket-12-dely" ← priority emoji in front of the channel name ('none' removes it). */
export function withPriority(name: string, level: 'low' | 'medium' | 'high' | 'none'): string {
  const bare = name.replace(/^(🟢|🟡|🔴)-?/u, '');
  const emoji = { low: '🟢', medium: '🟡', high: '🔴', none: '' }[level];
  return (emoji ? `${emoji}-${bare}` : bare).slice(0, 100);
}

/** Reasons given with /ticket close, used when the close is confirmed. */
const closeReasons = new Map<string, string>();

/** Members whose ticket is being created right now — a double click must not open two tickets. */
const opening = new Set<string>();

/** Open button (main panel, or an extra panel's ID): asks for a reason first when that's switched on. */
export async function onTicketOpen(ctx: ModuleContext, i: ButtonInteraction, panelId: string | null = null): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).tickets;
  if (c.enabled && c.askReason && ticketKind(c, panelId) && !tooMany(ctx, i)) {
    return void (await i.showModal({
      title: 'Open a ticket',
      custom_id: panelId ? `${CID.ticketReason}:${panelId}` : CID.ticketReason,
      components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.TextInput, custom_id: 'reason', label: 'What do you need help with?', style: TextInputStyle.Paragraph, required: true, max_length: 500 }] }],
    }));
  }
  await guardedOpen(ctx, i, null, panelId);
}

/** The reason pop-up was sent. */
export async function onTicketReason(ctx: ModuleContext, i: ModalSubmitInteraction, panelId: string | null = null): Promise<void> {
  if (!i.inCachedGuild()) return;
  await guardedOpen(ctx, i, i.fields.getTextInputValue('reason').trim() || null, panelId);
}

function tooMany(ctx: ModuleContext, i: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>): string[] | null {
  const open = ctx.store.openTickets(i.guildId, i.user.id).filter((id) => i.guild.channels.cache.has(id));
  return open.length >= ctx.config(i.guildId).tickets.maxOpenPerUser ? open : null;
}

/** Opens a ticket with text already filled in (used by the shop's Order button). True when it opened. */
export function openTicketWith(ctx: ModuleContext, i: ModalSubmitInteraction<'cached'>, reason: string, panelId: string | null, label: string): Promise<boolean> {
  return guardedOpen(ctx, i, reason, panelId, label);
}

async function guardedOpen(ctx: ModuleContext, i: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>, reason: string | null, panelId: string | null, label = 'What they need help with'): Promise<boolean> {
  const key = `${i.guildId}:${i.user.id}`;
  if (opening.has(key)) return (await reply(i, 'Your ticket is being created — one moment.'), false);
  opening.add(key);
  try {
    return await openTicket(ctx, i, reason, panelId, label);
  } finally {
    opening.delete(key);
  }
}

async function openTicket(ctx: ModuleContext, i: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>, reason: string | null, panelId: string | null, label: string): Promise<boolean> {
  const c = ctx.config(i.guildId).tickets;
  const kind = ticketKind(c, panelId);
  if (!c.enabled || !kind) return (await reply(i, 'Tickets aren’t open right now.'), false);
  const open = tooMany(ctx, i);
  if (open) return (await reply(i, `You already have an open ticket: ${open.map((id) => `<#${id}>`).join(', ')}`), false);
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const me = i.guild.members.me!;
  const staff = kind.staffRoleIds.filter((id) => i.guild.roles.cache.has(id));
  const category = kind.categoryId && i.guild.channels.cache.get(kind.categoryId)?.type === ChannelType.GuildCategory ? kind.categoryId : undefined;
  let channel: GuildTextBasedChannel;
  try {
    channel = await i.guild.channels.create({
      name: ticketChannelName(i.user.username, ctx.store.nextTicketNumber(i.guildId), kind.prefix),
      type: ChannelType.GuildText,
      parent: category,
      topic: truncate(`Ticket for ${i.user.tag} (${i.user.id})${reason ? ` — ${reason}` : ''}`, 1000),
      permissionOverwrites: [
        { id: i.guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
        { id: i.user.id, type: OverwriteType.Member, allow: MEMBER_ACCESS },
        { id: me.id, type: OverwriteType.Member, allow: [...MEMBER_ACCESS, P.ManageChannels, P.ManageMessages] },
        ...staff.map((id) => ({ id, type: OverwriteType.Role, allow: [...MEMBER_ACCESS, P.ManageMessages] })),
      ],
    });
  } catch (e) {
    ctx.log('warn', `Tickets: could not create a channel: ${(e as Error).message}`);
    return (await reply(i, 'I couldn’t create your ticket — a server admin needs to give me the Manage Channels permission.'), false);
  }
  ctx.store.addTicket(i.guildId, channel.id, i.user.id, reason, kind.panelId);

  const buttons = [
    { type: ComponentType.Button as const, style: ButtonStyle.Danger, label: 'Close ticket', custom_id: CID.ticketClose },
    ...(c.claimButton ? [{ type: ComponentType.Button as const, style: ButtonStyle.Success, label: 'Claim', custom_id: CID.ticketClaim }] : []),
  ];
  await channel
    .send({
      content: [`<@${i.user.id}>`, ...(kind.pingStaff ? staff.map((id) => `<@&${id}>`) : [])].join(' '),
      embeds: [
        {
          title: 'Ticket opened',
          description: renderTemplate(kind.openMessage, {
            user: `<@${i.user.id}>`,
            'user.name': i.member.displayName,
            'user.id': i.user.id,
            server: i.guild.name,
            memberCount: i.guild.memberCount,
          }),
          fields: reason ? [{ name: label, value: reason }] : [],
          color: hexToInt(kind.color),
        },
      ],
      components: [{ type: ComponentType.ActionRow, components: buttons }],
      allowedMentions: { users: [i.user.id], roles: kind.pingStaff ? staff : [] },
    })
    .catch((e: Error) => ctx.log('warn', `Tickets: could not post the welcome message in #${channel.name}: ${e.message}`));
  ctx.log('info', `Ticket opened by ${i.user.tag}: #${channel.name}`);
  await ticketLog(ctx, i.guild, { title: '🎫 Ticket opened', description: `<#${channel.id}> by <@${i.user.id}>${reason ? `\n>>> ${truncate(reason, 500)}` : ''}`, color: COLORS.info });
  await reply(i, `Your ticket is ready: <#${channel.id}>`);
  return true;
}

/** Staff for a ticket: its panel's staff plus the main staff (Manage Channels always counts). */
function isTicketStaff(ctx: ModuleContext, member: GuildMember, panelId: string | null): boolean {
  const c = ctx.config(member.guild.id).tickets;
  const roles = ticketKind(c, panelId)?.staffRoleIds ?? c.staffRoleIds;
  return isStaff(member, roles) || member.permissions.has(P.ManageChannels);
}

/** May this member close or manage the ticket in this channel? Its owner or its staff. */
function canManageTicket(ctx: ModuleContext, member: GuildMember, ticket: { userId: string; panelId: string | null }): boolean {
  return member.id === ticket.userId || isTicketStaff(ctx, member, ticket.panelId);
}

/** Claim button: a staff member takes the ticket. */
export async function onTicketClaim(ctx: ModuleContext, i: ButtonInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const ticket = ctx.store.ticketByChannel(i.channelId);
  if (!ticket || ticket.closed) return void (await reply(i, 'This isn’t an open ticket channel.'));
  if (!isTicketStaff(ctx, i.member, ticket.panelId)) return void (await reply(i, 'Only staff can claim tickets.'));
  if (!ctx.store.claimTicket(i.channelId, i.user.id)) return void (await reply(i, `This ticket was already claimed by <@${ctx.store.ticketByChannel(i.channelId)?.claimedBy}>.`));
  const embed = i.message.embeds[0];
  await i.update({
    embeds: embed ? [{ ...embed.toJSON(), fields: [...(embed.fields ?? []), { name: 'Claimed by', value: `<@${i.user.id}>` }] }] : [],
    components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Danger, label: 'Close ticket', custom_id: CID.ticketClose }] }],
  });
  if (i.channel?.isSendable()) await i.channel.send({ content: `🙋 <@${i.user.id}> will help you with this ticket.`, allowedMentions: { parse: [] } }).catch(() => null);
  await ticketLog(ctx, i.guild, { title: '🙋 Ticket claimed', description: `<#${i.channelId}> by <@${i.user.id}>`, color: COLORS.info });
}

/** Close button: ask to confirm (closing deletes the channel). */
export async function onTicketClose(ctx: ModuleContext, i: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild() || !i.channel) return;
  const ticket = ctx.store.ticketByChannel(i.channelId);
  if (!ticket || ticket.closed) return void (await reply(i, 'This isn’t an open ticket channel.'));
  if (!canManageTicket(ctx, i.member, ticket)) return void (await reply(i, 'Only the ticket owner or staff can close this ticket.'));
  await i.reply({
    content: 'Close this ticket? The channel will be deleted after a transcript is saved.',
    flags: MessageFlags.Ephemeral,
    components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Danger, label: 'Yes, close it', custom_id: CID.ticketCloseConfirm }] }],
  });
}

export async function onTicketCloseConfirm(ctx: ModuleContext, i: ButtonInteraction): Promise<void> {
  if (!i.inCachedGuild() || !i.channel) return;
  const ticket = ctx.store.ticketByChannel(i.channelId);
  if (!ticket || !canManageTicket(ctx, i.member, ticket)) return void (await reply(i, 'You can’t close this ticket.'));
  if (!ctx.store.closeTicket(i.channelId)) return void (await reply(i, 'This ticket is already closing.'));
  await i.update({ content: 'Closing… saving the transcript.', components: [] });
  const why = closeReasons.get(i.channelId);
  closeReasons.delete(i.channelId);
  await finishClose(ctx, i.guild, i.channel, ticket, { id: i.user.id, tag: i.user.tag }, why ? ` — ${why}` : '');
}

/** Close-request buttons: the ticket owner closes it, or keeps it open. */
export async function onCloseRequest(ctx: ModuleContext, i: ButtonInteraction, close: boolean): Promise<void> {
  if (!i.inCachedGuild() || !i.channel) return;
  const ticket = ctx.store.ticketByChannel(i.channelId);
  if (!ticket || ticket.closed) return void (await reply(i, 'This ticket is already closed.'));
  if (i.user.id !== ticket.userId && !isTicketStaff(ctx, i.member, ticket.panelId)) return void (await reply(i, 'Only the person who opened the ticket can answer.'));
  if (!close) return void (await i.update({ content: `👍 <@${i.user.id}> wants to keep this ticket open.`, components: [], allowedMentions: { parse: [] } }));
  if (!ctx.store.closeTicket(i.channelId)) return void (await reply(i, 'This ticket is already closing.'));
  await i.update({ content: 'Closing… saving the transcript.', components: [] });
  await finishClose(ctx, i.guild, i.channel, ticket, { id: i.user.id, tag: i.user.tag }, ' (accepted the close request)');
}

/** A star rating from the DM sent after a ticket closed. */
export async function onTicketFeedback(ctx: ModuleContext, i: ButtonInteraction, guildId: string, stars: number): Promise<void> {
  const guild = ctx.client.guilds.cache.get(guildId);
  const ticketName = i.message.embeds[0]?.footer?.text ?? 'a ticket';
  await i.update({ embeds: [{ description: `Thanks for your feedback! You gave **${'⭐'.repeat(stars)}**.`, color: COLORS.success }], components: [] });
  if (guild) await ticketLog(ctx, guild, { title: `${'⭐'.repeat(stars)}${'☆'.repeat(5 - stars)} Ticket rating`, description: `<@${i.user.id}> rated ${ticketName}`, color: stars >= 4 ? COLORS.success : stars >= 3 ? COLORS.warn : COLORS.danger });
}

/** Saves the transcript, tells everyone, and deletes the channel a few seconds later. The ticket is already marked closed. */
async function finishClose(
  ctx: ModuleContext,
  guild: Guild,
  channel: GuildTextBasedChannel,
  ticket: { userId: string; openedAt: string; reason: string | null; claimedBy: string | null },
  closedBy: { id: string; tag: string },
  why = '',
): Promise<void> {
  const c = ctx.config(guild.id).tickets;
  const messages: Message[] = [];
  let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    // Up to 1,000 messages — plenty for a support ticket.
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    before = batch.last()?.id;
  }
  messages.reverse();
  const text = formatTranscript(
    channel.name,
    messages.map((m) => ({
      at: m.createdAt,
      author: `${m.author.tag}${m.author.bot ? ' (bot)' : ''}`,
      content: m.content || (m.embeds[0]?.description ?? ''),
      attachments: [...m.attachments.values()].map((a) => a.url),
    })),
  );
  const file = () => new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `${channel.name}.txt` });
  const summary = {
    title: `Ticket closed — #${channel.name}`,
    description: [
      `Opened by <@${ticket.userId}> <t:${Math.floor(Date.parse(ticket.openedAt) / 1000)}:R>`,
      ticket.reason ? `**Reason:** ${truncate(ticket.reason, 500)}` : '',
      ticket.claimedBy ? `Handled by <@${ticket.claimedBy}>` : '',
      `Closed by <@${closedBy.id}>${why} · ${messages.length} message(s)`,
    ]
      .filter(Boolean)
      .join('\n'),
    color: COLORS.info,
  };

  const transcriptChannel = await sendableChannel(ctx, guild, c.transcriptChannelId, 'Ticket transcripts');
  await transcriptChannel?.send({ embeds: [summary], files: [file()], allowedMentions: { parse: [] } }).catch((e: Error) => ctx.log('warn', `Tickets: transcript not saved: ${e.message}`));
  if (c.dmTranscript) {
    const owner = await ctx.client.users.fetch(ticket.userId).catch(() => null);
    if (owner) await owner.send({ content: `Your ticket in **${guild.name}** was closed. Here’s a copy of the conversation.`, files: [file()] }).catch(() => null);
  }
  ctx.log('info', `Ticket #${channel.name} closed by ${closedBy.tag}${why}.`);
  await ticketLog(ctx, guild, { title: '🔒 Ticket closed', description: `#${channel.name} (opened by <@${ticket.userId}>) closed by <@${closedBy.id}>${why}`, color: COLORS.info });
  if (c.feedback) {
    const owner = await ctx.client.users.fetch(ticket.userId).catch(() => null);
    await owner
      ?.send({
        embeds: [{ description: `How did we do with your ticket in **${guild.name}**?`, color: COLORS.brand, footer: { text: `#${channel.name}` } }],
        components: [{ type: ComponentType.ActionRow, components: [1, 2, 3, 4, 5].map((n) => ({ type: ComponentType.Button as const, style: ButtonStyle.Secondary, label: `${n} ⭐`, custom_id: `df:tfb:${guild.id}:${n}` })) }],
      })
      .catch(() => null);
  }
  await channel.send({ content: `🔒 Ticket closed by <@${closedBy.id}>${why}. This channel will be deleted in a few seconds.`, allowedMentions: { parse: [] } }).catch(() => null);
  setTimeout(
    () => void channel.delete(`Ticket closed by ${closedBy.tag}`).catch((e: Error) => ctx.log('warn', `Tickets: could not delete #${channel.name}: ${e.message}`)),
    5000,
  );
}

/** Every 10 minutes: closes tickets nobody wrote in for the configured number of hours. */
export async function autoCloseTickets(ctx: ModuleContext, guild: Guild, now = Date.now()): Promise<void> {
  const c = ctx.config(guild.id).tickets;
  if (!c.enabled || !c.autoCloseHours) return;
  for (const t of ctx.store.openTicketsInGuild(guild.id)) {
    const channel = guild.channels.cache.get(t.channelId);
    if (!channel?.isTextBased()) continue;
    const last = channel.lastMessageId ? Number(SnowflakeUtil.timestampFrom(channel.lastMessageId)) : Date.parse(t.openedAt);
    if (!ticketIsIdle(last, c.autoCloseHours, now) || !ctx.store.closeTicket(t.channelId)) continue;
    await finishClose(ctx, guild, channel, t, { id: ctx.client.user.id, tag: ctx.client.user.tag }, ` (no messages for ${c.autoCloseHours} h)`);
  }
}

/** /ticket add | remove | rename | close */
export async function handleTicketCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  if (!ctx.config(i.guildId).tickets.enabled) return void (await reply(i, 'Tickets aren’t enabled in this server.'));
  const sub = i.options.getSubcommand();
  if (sub === 'close') {
    const why = i.options.getString('reason');
    if (why) closeReasons.set(i.channelId, truncate(why, 300));
    return onTicketClose(ctx, i);
  }
  if (sub === 'stats') {
    if (!isTicketStaff(ctx, i.member, null)) return void (await reply(i, 'Only ticket staff can see the stats.'));
    const s = ctx.store.ticketStats(i.guildId, Date.now() - 7 * 86_400_000);
    return void (await i.reply({
      embeds: [{ title: '🎫 Tickets — last 7 days', color: COLORS.info, fields: [{ name: 'Open now', value: String(s.open), inline: true }, { name: 'Closed', value: String(s.closed), inline: true }, { name: 'Most claimed', value: s.claims.map((x, n) => `${n + 1}. <@${x.userId}> — ${x.n}`).join('\n') || '—' }] }],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    }));
  }

  const ticket = ctx.store.ticketByChannel(i.channelId);
  if (!ticket || ticket.closed) return void (await reply(i, 'Use this inside an open ticket channel.'));
  if (!canManageTicket(ctx, i.member, ticket)) return void (await reply(i, 'Only the ticket owner or staff can do that.'));
  const channel = i.channel;
  if (!channel || channel.isThread() || !('permissionOverwrites' in channel)) return;

  const staffOnly = () => reply(i, 'Only ticket staff can do that.');
  if (sub === 'claim' || sub === 'unclaim' || sub === 'transfer') {
    if (!isTicketStaff(ctx, i.member, ticket.panelId)) return void (await staffOnly());
    if (sub === 'claim') {
      if (ticket.claimedBy) return void (await reply(i, `<@${ticket.claimedBy}> already has this ticket. Use /ticket transfer to take over.`));
      ctx.store.setTicketClaim(i.channelId, i.user.id);
      await ticketLog(ctx, i.guild, { title: '🙋 Ticket claimed', description: `<#${i.channelId}> by <@${i.user.id}>`, color: COLORS.info });
      return void (await i.reply({ content: `🙋 <@${i.user.id}> will help you with this ticket.`, allowedMentions: { parse: [] } }));
    }
    if (sub === 'unclaim') {
      if (!ticket.claimedBy) return void (await reply(i, 'Nobody has claimed this ticket.'));
      ctx.store.setTicketClaim(i.channelId, null);
      return void (await i.reply({ content: `↩️ This ticket is free again — any staff member can claim it.`, allowedMentions: { parse: [] } }));
    }
    const to = await i.guild.members.fetch(i.options.getUser('member', true).id).catch(() => null);
    if (!to || to.user.bot || !isTicketStaff(ctx, to, ticket.panelId)) return void (await reply(i, 'Pick a staff member who can see tickets.'));
    ctx.store.setTicketClaim(i.channelId, to.id);
    await channel.permissionOverwrites.edit(to.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => null);
    await ticketLog(ctx, i.guild, { title: '🔁 Ticket transferred', description: `<#${i.channelId}> to <@${to.id}> by <@${i.user.id}>`, color: COLORS.info });
    return void (await i.reply({ content: `🔁 <@${to.id}> is now handling this ticket.`, allowedMentions: { users: [to.id] } }));
  }
  if (sub === 'priority') {
    if (!isTicketStaff(ctx, i.member, ticket.panelId)) return void (await staffOnly());
    const level = i.options.getString('level', true) as 'low' | 'medium' | 'high' | 'none';
    const renamed = await channel.setName(withPriority(channel.name, level)).then(() => true, () => false);
    return void (await reply(i, renamed ? `Priority set to **${level}**.` : 'Couldn’t rename — Discord allows 2 renames every 10 minutes. Try again later.'));
  }
  if (sub === 'closerequest') {
    if (!isTicketStaff(ctx, i.member, ticket.panelId)) return void (await staffOnly());
    const why = i.options.getString('reason');
    return void (await i.reply({
      content: `<@${ticket.userId}>, <@${i.user.id}> thinks this ticket can be closed${why ? `: ${truncate(why, 300)}` : '.'} Is everything sorted?`,
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            { type: ComponentType.Button, style: ButtonStyle.Success, label: 'Yes, close it', custom_id: 'df:ticket:crok' },
            { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Keep it open', custom_id: 'df:ticket:crno' },
          ],
        },
      ],
      allowedMentions: { users: [ticket.userId] },
    }));
  }

  if (sub === 'rename') {
    const name = (i.options.getString('name', true).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'ticket').slice(0, 90);
    const renamed = await channel.setName(name).then(() => true, () => false);
    // Discord allows 2 renames per channel every 10 minutes.
    return void (await reply(i, renamed ? `Renamed to #${name}.` : 'Couldn’t rename — Discord allows 2 renames every 10 minutes. Try again later.'));
  }

  // A member or a whole role.
  const who = i.options.getMentionable('who', true);
  const isRole = who instanceof Role;
  const id = isRole ? who.id : 'user' in who ? who.user.id : who.id;
  const label = isRole ? `<@&${id}>` : `<@${id}>`;
  if (!isRole && ('bot' in who ? who.bot : who.user.bot)) return void (await reply(i, 'Bots can’t be added to or removed from tickets.'));
  if (isRole && id === i.guildId) return void (await reply(i, 'Pick a role other than @everyone — that would make the ticket public.'));
  const failed = 'I couldn’t change this channel’s permissions — I need Manage Channels and Manage Permissions here.';
  if (sub === 'remove') {
    if (id === ticket.userId) return void (await reply(i, 'You can’t remove the person who opened the ticket.'));
    const removed = await channel.permissionOverwrites.delete(id).then(() => true, () => false);
    if (!removed) return void (await reply(i, failed));
    return void (await i.reply({ content: `Removed ${label} from this ticket.`, allowedMentions: { parse: [] } }));
  }
  const added = await channel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }).then(
    () => true,
    () => false,
  );
  if (!added) return void (await reply(i, failed));
  await i.reply({ content: `Added ${label} to this ticket.`, allowedMentions: isRole ? { parse: [] } : { users: [id] } });
}
