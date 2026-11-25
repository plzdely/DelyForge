import { randomInt } from 'node:crypto';
import {
  type APIEmbed,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  ComponentType,
  MessageFlags,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  TextInputStyle,
} from 'discord.js';
import type { Giveaway } from '../store.js';
import { COLORS, type ModuleContext, hexToInt, sendableChannel, truncate } from './context.js';
import { isStaff } from './roles.js';

const ephemeral = (i: ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction, content: string) =>
  i.replied || i.deferred
    ? i.editReply({ content, allowedMentions: { parse: [] } })
    : i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

// ─── Suggestions ──────────────────────────────────────────────────────────────────────────────────────────────────

const STATUS = {
  open: { label: 'Open for votes', color: COLORS.info },
  approved: { label: '✅ Approved', color: COLORS.success },
  rejected: { label: '❌ Rejected', color: COLORS.danger },
} as const;

function suggestionMessage(s: { id: number; userId: string; content: string; status: string; reason?: string | null }, votes: { up: number; down: number }, decidedBy?: string) {
  const status = STATUS[s.status as keyof typeof STATUS] ?? STATUS.open;
  const open = s.status === 'open';
  const btn = (label: string, id: string, style: ButtonStyle, disabled = !open) => ({ type: ComponentType.Button as const, style, label, custom_id: id, disabled });
  return {
    embeds: [
      {
        title: `Suggestion #${s.id}`,
        description: s.content,
        color: status.color,
        fields: [
          { name: 'Votes', value: `👍 ${votes.up}   👎 ${votes.down}`, inline: true },
          { name: 'Status', value: decidedBy ? `${status.label} by <@${decidedBy}>` : status.label, inline: true },
          { name: 'Suggested by', value: `<@${s.userId}>`, inline: true },
          ...(s.reason ? [{ name: 'Reason', value: truncate(s.reason, 1000) }] : []),
        ],
      } satisfies APIEmbed,
    ],
    components: [
      {
        type: ComponentType.ActionRow as const,
        components: [
          btn('👍', `df:sug:up:${s.id}`, ButtonStyle.Secondary),
          btn('👎', `df:sug:down:${s.id}`, ButtonStyle.Secondary),
          btn('Approve', `df:sug:approve:${s.id}`, ButtonStyle.Success),
          btn('Reject', `df:sug:reject:${s.id}`, ButtonStyle.Danger),
        ],
      },
    ],
    allowedMentions: { parse: [] as [] },
  };
}

export async function handleSuggest(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).suggestions;
  if (!c.enabled || !c.channelId) return void (await ephemeral(i, 'Suggestions aren’t set up in this server.'));
  const channel = await sendableChannel(ctx, i.guild, c.channelId, 'Suggestions');
  if (!channel) return void (await ephemeral(i, 'The suggestions channel isn’t available right now.'));
  const content = truncate(i.options.getString('idea', true).trim(), 1500);
  const id = ctx.store.addSuggestion(i.guildId, channel.id, i.user.id, content);
  const msg = await channel.send(suggestionMessage({ id, userId: i.user.id, content, status: 'open' }, { up: 0, down: 0 })).catch((e: Error) => {
    ctx.log('warn', `Suggestions: could not post: ${e.message}`);
    return null;
  });
  if (!msg) return void (await ephemeral(i, 'I couldn’t post your suggestion — please tell a server admin (the bot can’t send embeds there).'));
  ctx.store.setSuggestionMessage(id, msg.id);
  await ephemeral(i, `Thanks! Your suggestion was posted: ${msg.url}`);
}

export async function onSuggestionButton(ctx: ModuleContext, i: ButtonInteraction, action: string, id: number): Promise<void> {
  if (!i.inCachedGuild()) return;
  const s = ctx.store.suggestion(id);
  if (!s || s.guildId !== i.guildId) return void (await ephemeral(i, 'This suggestion no longer exists.'));
  if (s.status !== 'open') return void (await ephemeral(i, 'This suggestion has already been decided.'));

  if (action === 'up' || action === 'down') {
    const votes = ctx.store.vote(id, i.user.id, action === 'up' ? 1 : -1);
    await i.update(suggestionMessage(s, votes));
    return;
  }
  if (!isStaff(i.member, ctx.config(i.guildId).suggestions.staffRoleIds)) {
    return void (await ephemeral(i, 'Only staff can approve or reject suggestions.'));
  }
  if (action !== 'approve' && action !== 'reject') return;
  await i.showModal({
    title: `${action === 'approve' ? 'Approve' : 'Reject'} suggestion #${id}`,
    custom_id: `df:sug:decide:${action}:${id}`,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [{ type: ComponentType.TextInput, custom_id: 'reason', label: 'Reason (optional, shown to everyone)', style: TextInputStyle.Paragraph, required: false, max_length: 500 }],
      },
    ],
  });
}

/** The staff member submitted the Approve/Reject pop-up. Everything is checked again: time has passed. */
export async function onSuggestionDecision(ctx: ModuleContext, i: ModalSubmitInteraction, action: string, id: number): Promise<void> {
  if (!i.inCachedGuild() || (action !== 'approve' && action !== 'reject')) return;
  const s = ctx.store.suggestion(id);
  if (!s || s.guildId !== i.guildId) return void (await ephemeral(i, 'This suggestion no longer exists.'));
  if (!isStaff(i.member, ctx.config(i.guildId).suggestions.staffRoleIds)) return void (await ephemeral(i, 'Only staff can approve or reject suggestions.'));
  const status = action === 'approve' ? 'approved' : 'rejected';
  const reason = i.fields.getTextInputValue('reason').trim() || null;
  if (!ctx.store.setSuggestionStatus(id, status, reason)) return void (await ephemeral(i, 'This suggestion has already been decided.'));
  const message = suggestionMessage({ ...s, status, reason }, ctx.store.votes(id), i.user.id);
  if (i.isFromMessage()) await i.update(message);
  else await ephemeral(i, `Suggestion #${id} ${status}.`);
}

// ─── Giveaways ────────────────────────────────────────────────────────────────────────────────────────────────────

/** "1h30m", "2d", "45m" → milliseconds (1 minute to 30 days), or null. */
export function parseDuration(text: string): number | null {
  const re = /(\d+)\s*([dhm])/gi;
  const units: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000 };
  let total = 0;
  let matched = '';
  for (const m of text.matchAll(re)) {
    total += Number(m[1]) * units[m[2]!.toLowerCase()]!;
    matched += m[0];
  }
  if (!matched || matched.replace(/\s/g, '') !== text.replace(/\s/g, '')) return null;
  return total >= 60_000 && total <= 30 * 86_400_000 ? total : null;
}

/** Fair, unique random winners (crypto-quality randomness), excluding anyone in `exclude`. */
export function pickWinners(entries: readonly string[], count: number, exclude: readonly string[] = []): string[] {
  const pool = entries.filter((e) => !exclude.includes(e));
  const winners: string[] = [];
  while (winners.length < count && pool.length) winners.push(pool.splice(randomInt(pool.length), 1)[0]!);
  return winners;
}

/**
 * Draws winners in random order, skipping anyone who has since lost the required role or left the server.
 * `isEligible` is only asked about as many people as needed.
 */
export async function drawEligible(
  entries: readonly string[],
  count: number,
  exclude: readonly string[],
  isEligible: (userId: string) => Promise<boolean>,
): Promise<string[]> {
  const winners: string[] = [];
  for (const id of pickWinners(entries, entries.length, exclude)) {
    if (winners.length >= count) break;
    if (await isEligible(id)) winners.push(id);
  }
  return winners;
}

function eligibility(guild: Guild | undefined, g: Giveaway): (userId: string) => Promise<boolean> {
  return async (userId) => {
    if (!g.requiredRoleId) return true;
    const member = await guild?.members.fetch(userId).catch(() => null);
    return Boolean(member?.roles.cache.has(g.requiredRoleId));
  };
}

function giveawayEmbed(g: Giveaway, color: string, entries?: number): APIEmbed {
  const ends = Math.floor(g.endsAt / 1000);
  return {
    title: `🎉 ${g.prize}`,
    description: g.ended
      ? `Ended <t:${ends}:R>\n**Winner${g.winnerIds.length === 1 ? '' : 's'}:** ${g.winnerIds.length ? g.winnerIds.map((w) => `<@${w}>`).join(', ') : 'nobody entered 😢'}`
      : `Click **Enter** to join!\nEnds <t:${ends}:R> (<t:${ends}:f>)\n**Winners:** ${g.winners}${g.requiredRoleId ? `\n**Required role:** <@&${g.requiredRoleId}>` : ''}`,
    footer: { text: `Giveaway #${g.id}${entries !== undefined ? ` · ${entries} entries` : ''}` },
    color: g.ended ? COLORS.brand : hexToInt(color),
  };
}

const enterRow = (id: number, disabled: boolean) => ({
  type: ComponentType.ActionRow as const,
  components: [{ type: ComponentType.Button as const, style: ButtonStyle.Primary, label: 'Enter', emoji: { name: '🎉' }, custom_id: `df:gw:enter:${id}`, disabled }],
});

/** Shows the current entry count on the giveaway message, at most every 5 s per giveaway (Discord rate limits). */
const countTimers = new Map<number, ReturnType<typeof setTimeout>>();
function refreshEntryCount(ctx: ModuleContext, i: ButtonInteraction<'cached'>, id: number): void {
  if (countTimers.has(id)) return;
  countTimers.set(
    id,
    setTimeout(() => {
      countTimers.delete(id);
      const g = ctx.store.giveaway(id);
      if (!g || g.ended || !g.messageId) return;
      const embed = giveawayEmbed(g, ctx.config(g.guildId).giveaways.color, ctx.store.entries(id).length);
      void i.message.edit({ embeds: [embed] }).catch(() => null);
    }, 5_000),
  );
}

async function announceWinners(ctx: ModuleContext, client: Client, g: Giveaway, reroll: boolean, newWinners = g.winnerIds): Promise<void> {
  const channel = await client.channels.fetch(g.channelId).catch(() => null);
  if (!channel?.isSendable()) return;
  const config = ctx.config(g.guildId).giveaways;
  if (g.messageId && 'messages' in channel) {
    const count = ctx.store.entries(g.id).length;
    await channel.messages.edit(g.messageId, { embeds: [giveawayEmbed(g, config.color, count)], components: [enterRow(g.id, true)] }).catch(() => null);
  }
  const content = newWinners.length
    ? `🎉 ${reroll ? 'New winner' : 'Congratulations'} ${newWinners.map((w) => `<@${w}>`).join(', ')}! You won **${g.prize}**.`
    : `The giveaway for **${g.prize}** ended with no entries.`;
  await channel.send({ content, allowedMentions: { users: newWinners } }).catch(() => null);
}

/** Ends giveaways whose time is up. Runs every 15 s; safe to run twice (the store only lets one caller end each). */
export async function endDueGiveaways(ctx: ModuleContext, client: Client): Promise<void> {
  for (const g of ctx.store.dueGiveaways(Date.now())) {
    if (!client.guilds.cache.has(g.guildId)) continue;
    const winners = await drawEligible(ctx.store.entries(g.id), g.winners, [], eligibility(client.guilds.cache.get(g.guildId), g));
    if (!ctx.store.endGiveaway(g.id, winners)) continue;
    await announceWinners(ctx, client, { ...g, ended: true, winnerIds: winners }, false);
    ctx.log('info', `Giveaway #${g.id} (“${g.prize}”) ended with ${winners.length} winner(s).`);
  }
}

export async function handleGiveaway(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).giveaways;
  if (!c.enabled) return void (await ephemeral(i, 'Giveaways aren’t enabled in this server.'));
  if (!isStaff(i.member, c.managerRoleIds)) return void (await ephemeral(i, 'Only giveaway managers can do that.'));
  const sub = i.options.getSubcommand();

  if (sub === 'start') {
    const duration = parseDuration(i.options.getString('duration', true));
    if (!duration) return void (await ephemeral(i, 'Use a duration like `30m`, `2h`, `1d` or `1h30m` (1 minute to 30 days).'));
    const target = i.options.getChannel('channel') ?? i.channel;
    const channel = target ? await sendableChannel(ctx, i.guild, target.id, 'Giveaway') : null;
    if (!channel) return void (await ephemeral(i, 'I can’t post in that channel.'));
    // The bot must not post somewhere the manager couldn't post themselves.
    if (!channel.permissionsFor(i.member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return void (await ephemeral(i, 'You can only start giveaways in channels where you can post.'));
    }
    const prize = truncate(i.options.getString('prize', true).trim(), 200);
    const winners = i.options.getInteger('winners') ?? 1;
    const role = i.options.getRole('required_role');
    // @everyone (same ID as the server) means no requirement.
    const requiredRoleId = role && role.id !== i.guildId ? role.id : null;
    const id = ctx.store.addGiveaway({ guildId: i.guildId, channelId: channel.id, prize, winners, hostId: i.user.id, endsAt: Date.now() + duration, requiredRoleId });
    const g = ctx.store.giveaway(id)!;
    const msg = await channel.send({ embeds: [giveawayEmbed(g, c.color)], components: [enterRow(id, false)], allowedMentions: { parse: [] } });
    ctx.store.setGiveawayMessage(id, msg.id);
    return void (await ephemeral(i, `Giveaway #${id} started: ${msg.url}`));
  }

  const id = i.options.getInteger('id', true);
  const g = ctx.store.giveaway(id);
  if (!g || g.guildId !== i.guildId) return void (await ephemeral(i, `There’s no giveaway #${id} in this server.`));

  if (sub === 'end') {
    if (g.ended) return void (await ephemeral(i, 'That giveaway has already ended.'));
    const winners = await drawEligible(ctx.store.entries(id), g.winners, [], eligibility(i.guild, g));
    if (!ctx.store.endGiveaway(id, winners)) return void (await ephemeral(i, 'That giveaway has already ended.'));
    await announceWinners(ctx, i.client, { ...g, ended: true, winnerIds: winners }, false);
    return void (await ephemeral(i, `Giveaway #${id} ended.`));
  }

  // reroll
  if (!g.ended) return void (await ephemeral(i, 'That giveaway is still running — end it first.'));
  const fresh = await drawEligible(ctx.store.entries(id), 1, g.winnerIds, eligibility(i.guild, g));
  if (!fresh.length) return void (await ephemeral(i, 'There’s nobody left to pick.'));
  const winnerIds = [...g.winnerIds, ...fresh];
  ctx.store.setWinners(id, winnerIds);
  await announceWinners(ctx, i.client, { ...g, winnerIds }, true, fresh);
  await ephemeral(i, `Rerolled giveaway #${id}.`);
}

export async function onGiveawayEnter(ctx: ModuleContext, i: ButtonInteraction, id: number): Promise<void> {
  if (!i.inCachedGuild()) return;
  const g = ctx.store.giveaway(id);
  if (!g || g.guildId !== i.guildId || g.ended || g.endsAt <= Date.now()) return void (await ephemeral(i, 'This giveaway has ended.'));
  if (i.user.bot) return;
  // Members who lost the role can still leave; only joining needs it (winners are checked again when drawn).
  if (g.requiredRoleId && !i.member.roles.cache.has(g.requiredRoleId) && !ctx.store.entries(id).includes(i.user.id)) {
    return void (await ephemeral(i, `You need the <@&${g.requiredRoleId}> role to enter this giveaway.`));
  }
  const { entered, count } = ctx.store.toggleEntry(id, i.user.id);
  refreshEntryCount(ctx, i, id);
  await ephemeral(i, entered ? `You’re in! 🎉 Good luck. (${count} entries) Click again to leave.` : `You left the giveaway. (${count} entries)`);
}
