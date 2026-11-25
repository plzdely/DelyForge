import { renderTemplate } from '@delyforge/shared';
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
  SnowflakeUtil,
  TextInputStyle,
} from 'discord.js';
import { COLORS, type ModuleContext, hexToInt, sendableChannel, truncate } from './context.js';
import { CID } from './panels.js';
import { isStaff } from './roles.js';

export const TICKET_COMMANDS = new Set(['ticket']);

const P = PermissionFlagsBits;
const MEMBER_ACCESS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

/** "Dely 🎮!" → "dely" — keeps ticket channel names valid and readable. */
export function ticketChannelName(username: string, n: number): string {
  const clean = username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'member';
  return `ticket-${n}-${clean}`;
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

/** Members whose ticket is being created right now — a double click must not open two tickets. */
const opening = new Set<string>();

/** Open button: asks for a reason first when that's switched on. */
export async function onTicketOpen(ctx: ModuleContext, i: ButtonInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).tickets;
  if (c.enabled && c.askReason && !tooMany(ctx, i)) {
    return void (await i.showModal({
      title: 'Open a ticket',
      custom_id: CID.ticketReason,
      components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.TextInput, custom_id: 'reason', label: 'What do you need help with?', style: TextInputStyle.Paragraph, required: true, max_length: 500 }] }],
    }));
  }
  await guardedOpen(ctx, i, null);
}

/** The reason pop-up was sent. */
export async function onTicketReason(ctx: ModuleContext, i: ModalSubmitInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  await guardedOpen(ctx, i, i.fields.getTextInputValue('reason').trim() || null);
}

function tooMany(ctx: ModuleContext, i: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>): string[] | null {
  const open = ctx.store.openTickets(i.guildId, i.user.id).filter((id) => i.guild.channels.cache.has(id));
  return open.length >= ctx.config(i.guildId).tickets.maxOpenPerUser ? open : null;
}

async function guardedOpen(ctx: ModuleContext, i: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>, reason: string | null): Promise<void> {
  const key = `${i.guildId}:${i.user.id}`;
  if (opening.has(key)) return void (await reply(i, 'Your ticket is being created — one moment.'));
  opening.add(key);
  try {
    await openTicket(ctx, i, reason);
  } finally {
    opening.delete(key);
  }
}

async function openTicket(ctx: ModuleContext, i: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>, reason: string | null): Promise<void> {
  const c = ctx.config(i.guildId).tickets;
  if (!c.enabled) return void (await reply(i, 'Tickets aren’t open right now.'));
  const open = tooMany(ctx, i);
  if (open) return void (await reply(i, `You already have an open ticket: ${open.map((id) => `<#${id}>`).join(', ')}`));
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const me = i.guild.members.me!;
  const staff = c.staffRoleIds.filter((id) => i.guild.roles.cache.has(id));
  const category = c.categoryId && i.guild.channels.cache.get(c.categoryId)?.type === ChannelType.GuildCategory ? c.categoryId : undefined;
  let channel: GuildTextBasedChannel;
  try {
    channel = await i.guild.channels.create({
      name: ticketChannelName(i.user.username, ctx.store.nextTicketNumber(i.guildId)),
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
    return void (await reply(i, 'I couldn’t create your ticket — a server admin needs to give me the Manage Channels permission.'));
  }
  ctx.store.addTicket(i.guildId, channel.id, i.user.id, reason);

  const buttons = [
    { type: ComponentType.Button as const, style: ButtonStyle.Danger, label: 'Close ticket', custom_id: CID.ticketClose },
    ...(c.claimButton ? [{ type: ComponentType.Button as const, style: ButtonStyle.Success, label: 'Claim', custom_id: CID.ticketClaim }] : []),
  ];
  await channel
    .send({
      content: [`<@${i.user.id}>`, ...staff.map((id) => `<@&${id}>`)].join(' '),
      embeds: [
        {
          title: 'Ticket opened',
          description: renderTemplate(c.openMessage, {
            user: `<@${i.user.id}>`,
            'user.name': i.member.displayName,
            'user.id': i.user.id,
            server: i.guild.name,
            memberCount: i.guild.memberCount,
          }),
          fields: reason ? [{ name: 'What they need help with', value: reason }] : [],
          color: hexToInt(c.panel.color),
        },
      ],
      components: [{ type: ComponentType.ActionRow, components: buttons }],
      allowedMentions: { users: [i.user.id], roles: staff },
    })
    .catch((e: Error) => ctx.log('warn', `Tickets: could not post the welcome message in #${channel.name}: ${e.message}`));
  ctx.log('info', `Ticket opened by ${i.user.tag}: #${channel.name}`);
  await reply(i, `Your ticket is ready: <#${channel.id}>`);
}

/** May this member close or manage the ticket in this channel? Owner, staff roles, or Manage Channels. */
function canManageTicket(ctx: ModuleContext, member: GuildMember, ownerId: string): boolean {
  const c = ctx.config(member.guild.id).tickets;
  return member.id === ownerId || isStaff(member, c.staffRoleIds) || member.permissions.has(P.ManageChannels);
}

/** Claim button: a staff member takes the ticket. */
export async function onTicketClaim(ctx: ModuleContext, i: ButtonInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const ticket = ctx.store.ticketByChannel(i.channelId);
  if (!ticket || ticket.closed) return void (await reply(i, 'This isn’t an open ticket channel.'));
  const c = ctx.config(i.guildId).tickets;
  if (!isStaff(i.member, c.staffRoleIds) && !i.member.permissions.has(P.ManageChannels)) return void (await reply(i, 'Only staff can claim tickets.'));
  if (!ctx.store.claimTicket(i.channelId, i.user.id)) return void (await reply(i, `This ticket was already claimed by <@${ctx.store.ticketByChannel(i.channelId)?.claimedBy}>.`));
  const embed = i.message.embeds[0];
  await i.update({
    embeds: embed ? [{ ...embed.toJSON(), fields: [...(embed.fields ?? []), { name: 'Claimed by', value: `<@${i.user.id}>` }] }] : [],
    components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Danger, label: 'Close ticket', custom_id: CID.ticketClose }] }],
  });
  if (i.channel?.isSendable()) await i.channel.send({ content: `🙋 <@${i.user.id}> will help you with this ticket.`, allowedMentions: { parse: [] } }).catch(() => null);
}

/** Close button: ask to confirm (closing deletes the channel). */
export async function onTicketClose(ctx: ModuleContext, i: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild() || !i.channel) return;
  const ticket = ctx.store.ticketByChannel(i.channelId);
  if (!ticket || ticket.closed) return void (await reply(i, 'This isn’t an open ticket channel.'));
  if (!canManageTicket(ctx, i.member, ticket.userId)) return void (await reply(i, 'Only the ticket owner or staff can close this ticket.'));
  await i.reply({
    content: 'Close this ticket? The channel will be deleted after a transcript is saved.',
    flags: MessageFlags.Ephemeral,
    components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Danger, label: 'Yes, close it', custom_id: CID.ticketCloseConfirm }] }],
  });
}

export async function onTicketCloseConfirm(ctx: ModuleContext, i: ButtonInteraction): Promise<void> {
  if (!i.inCachedGuild() || !i.channel) return;
  const ticket = ctx.store.ticketByChannel(i.channelId);
  if (!ticket || !canManageTicket(ctx, i.member, ticket.userId)) return void (await reply(i, 'You can’t close this ticket.'));
  if (!ctx.store.closeTicket(i.channelId)) return void (await reply(i, 'This ticket is already closing.'));
  await i.update({ content: 'Closing… saving the transcript.', components: [] });
  await finishClose(ctx, i.guild, i.channel, ticket, { id: i.user.id, tag: i.user.tag });
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
  if (sub === 'close') return onTicketClose(ctx, i);

  const ticket = ctx.store.ticketByChannel(i.channelId);
  if (!ticket || ticket.closed) return void (await reply(i, 'Use this inside an open ticket channel.'));
  if (!canManageTicket(ctx, i.member, ticket.userId)) return void (await reply(i, 'Only the ticket owner or staff can do that.'));
  const channel = i.channel;
  if (!channel || channel.isThread() || !('permissionOverwrites' in channel)) return;

  if (sub === 'rename') {
    const name = (i.options.getString('name', true).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'ticket').slice(0, 90);
    const renamed = await channel.setName(name).then(() => true, () => false);
    // Discord allows 2 renames per channel every 10 minutes.
    return void (await reply(i, renamed ? `Renamed to #${name}.` : 'Couldn’t rename — Discord allows 2 renames every 10 minutes. Try again later.'));
  }

  const user = i.options.getUser('member', true);
  if (user.bot) return void (await reply(i, 'Bots can’t be added to or removed from tickets.'));
  if (sub === 'remove') {
    if (user.id === ticket.userId) return void (await reply(i, 'You can’t remove the person who opened the ticket.'));
    const removed = await channel.permissionOverwrites.delete(user.id).then(() => true, () => false);
    if (!removed) return void (await reply(i, 'I couldn’t change this channel’s permissions — I need Manage Channels and Manage Permissions here.'));
    return void (await i.reply({ content: `Removed <@${user.id}> from this ticket.`, allowedMentions: { parse: [] } }));
  }
  const added = await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }).then(
    () => true,
    () => false,
  );
  if (!added) return void (await reply(i, 'I couldn’t change this channel’s permissions — I need Manage Channels and Manage Permissions here.'));
  await i.reply({ content: `Added <@${user.id}> to this ticket.`, allowedMentions: { users: [user.id] } });
}
