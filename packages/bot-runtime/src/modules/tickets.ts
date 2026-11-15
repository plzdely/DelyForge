import { renderTemplate } from '@delyforge/shared';
import {
  AttachmentBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  ComponentType,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
} from 'discord.js';
import { COLORS, type ModuleContext, hexToInt, sendableChannel } from './context.js';
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

const reply = (i: ButtonInteraction | ChatInputCommandInteraction, content: string) =>
  i.replied || i.deferred
    ? i.editReply({ content, allowedMentions: { parse: [] } })
    : i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

export async function onTicketOpen(ctx: ModuleContext, i: ButtonInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).tickets;
  if (!c.enabled) return void (await reply(i, 'Tickets aren’t open right now.'));
  const open = ctx.store.openTickets(i.guildId, i.user.id).filter((id) => i.guild.channels.cache.has(id));
  if (open.length >= c.maxOpenPerUser) {
    return void (await reply(i, `You already have an open ticket: ${open.map((id) => `<#${id}>`).join(', ')}`));
  }
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
      topic: `Ticket for ${i.user.tag} (${i.user.id})`,
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
  ctx.store.addTicket(i.guildId, channel.id, i.user.id);

  await channel.send({
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
        color: hexToInt(c.panel.color),
      },
    ],
    components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Danger, label: 'Close ticket', custom_id: CID.ticketClose }] }],
    allowedMentions: { users: [i.user.id], roles: staff },
  });
  ctx.log('info', `Ticket opened by ${i.user.tag}: #${channel.name}`);
  await reply(i, `Your ticket is ready: <#${channel.id}>`);
}

/** May this member close or manage the ticket in this channel? Owner, staff roles, or Manage Channels. */
function canManageTicket(ctx: ModuleContext, member: GuildMember, ownerId: string): boolean {
  const c = ctx.config(member.guild.id).tickets;
  return member.id === ownerId || isStaff(member, c.staffRoleIds) || member.permissions.has(P.ManageChannels);
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

  const c = ctx.config(i.guildId).tickets;
  const channel = i.channel;
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
    description: `Opened by <@${ticket.userId}> <t:${Math.floor(Date.parse(ticket.openedAt) / 1000)}:R>\nClosed by <@${i.user.id}> · ${messages.length} message(s)`,
    color: COLORS.info,
  };

  const transcriptChannel = await sendableChannel(ctx, i.guild, c.transcriptChannelId, 'Ticket transcripts');
  await transcriptChannel?.send({ embeds: [summary], files: [file()], allowedMentions: { parse: [] } }).catch((e: Error) => ctx.log('warn', `Tickets: transcript not saved: ${e.message}`));
  if (c.dmTranscript) {
    const owner = await i.client.users.fetch(ticket.userId).catch(() => null);
    if (owner) await owner.send({ content: `Your ticket in **${i.guild.name}** was closed. Here’s a copy of the conversation.`, files: [file()] }).catch(() => null);
  }
  ctx.log('info', `Ticket #${channel.name} closed by ${i.user.tag}.`);
  setTimeout(() => void channel.delete(`Ticket closed by ${i.user.tag}`).catch(() => null), 5000);
}

/** /ticket add | close */
export async function handleTicketCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  if (!ctx.config(i.guildId).tickets.enabled) return void (await reply(i, 'Tickets aren’t enabled in this server.'));
  const sub = i.options.getSubcommand();
  if (sub === 'close') return onTicketClose(ctx, i);

  const ticket = ctx.store.ticketByChannel(i.channelId);
  if (!ticket || ticket.closed) return void (await reply(i, 'Use this inside an open ticket channel.'));
  if (!canManageTicket(ctx, i.member, ticket.userId)) return void (await reply(i, 'Only the ticket owner or staff can add people.'));
  const user = i.options.getUser('member', true);
  const channel = i.channel;
  if (!channel || channel.isThread() || !('permissionOverwrites' in channel)) return;
  await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
  await i.reply({ content: `Added <@${user.id}> to this ticket.`, allowedMentions: { users: [user.id] } });
}

