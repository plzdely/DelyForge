import { isThanks } from '@delyforge/shared';
import { type ChatInputCommandInteraction, type Guild, type GuildMember, type Message, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { COLORS, type ModuleContext, sendableChannel, truncate } from './context.js';
import { assignable } from './roles.js';

/** Reputation: one rep point per giver per cooldown, via /rep give or "thanks @someone". */

async function afterRep(ctx: ModuleContext, guild: Guild, giverId: string, receiver: GuildMember, total: number, why: string): Promise<void> {
  const c = ctx.config(guild.id).reputation;
  const earned = c.rewards.filter((r) => total >= r.reps).map((r) => r.roleId);
  const add = assignable(receiver, earned).filter((r) => !receiver.roles.cache.has(r));
  if (add.length) await receiver.roles.add(add, `Reached ${total} rep`).catch(() => null);
  const log = await sendableChannel(ctx, guild, c.logChannelId, 'Reputation log');
  await log?.send({ content: `⭐ <@${giverId}> gave <@${receiver.id}> rep (now **${total}**)${why ? ` — ${truncate(why, 200)}` : ''}`, allowedMentions: { parse: [] } }).catch(() => null);
}

/** Gives rep if allowed; returns a message for the giver. */
async function give(ctx: ModuleContext, guild: Guild, giver: GuildMember, receiver: GuildMember, why: string): Promise<{ ok: boolean; text: string }> {
  if (receiver.user.bot || receiver.id === giver.id) return { ok: false, text: 'You can’t give rep to yourself or a bot.' };
  const c = ctx.config(guild.id).reputation;
  const total = ctx.store.giveRep(guild.id, giver.id, receiver.id, c.cooldownHours * 3_600_000, Date.now());
  if (total === null) return { ok: false, text: `You can give rep again <t:${Math.floor((ctx.store.repReadyAt(guild.id, giver.id, c.cooldownHours * 3_600_000) ?? Date.now()) / 1000)}:R>.` };
  await afterRep(ctx, guild, giver.id, receiver, total, why);
  return { ok: true, text: `⭐ <@${giver.id}> gave <@${receiver.id}> a rep point! They have **${total}** now.` };
}

export async function handleRepCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const c = ctx.config(i.guildId).reputation;
  const say = (content: string, ephemeral = true) => i.reply({ content, allowedMentions: { parse: [] }, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
  if (!c.enabled) return void (await say('Reputation isn’t enabled here.'));
  const sub = i.options.getSubcommand();
  if (sub === 'top') {
    const top = ctx.store.topReps(i.guildId, 10);
    return void (await i.reply({ embeds: [{ title: '⭐ Most helpful members', description: top.map((t, n) => `**${n + 1}.** <@${t.userId}> — ${t.reps} rep`).join('\n') || 'Nobody has rep yet.', color: COLORS.brand }], allowedMentions: { parse: [] } }));
  }
  if (sub === 'check') {
    const user = i.options.getUser('member') ?? i.user;
    return void (await say(`⭐ <@${user.id}> has **${ctx.store.reps(i.guildId, user.id)}** rep.`, false));
  }
  const target = await i.guild.members.fetch(i.options.getUser('member', true).id).catch(() => null);
  if (!target) return void (await say('That person isn’t in this server.'));
  if (sub === 'set') {
    if (!i.member.permissions.has(PermissionFlagsBits.ManageGuild)) return void (await say('Only staff with Manage Server can do that.'));
    ctx.store.setReps(i.guildId, target.id, i.options.getInteger('amount', true));
    return void (await say(`Set <@${target.id}>’s rep to ${i.options.getInteger('amount', true)}.`));
  }
  const r = await give(ctx, i.guild, i.member, target, i.options.getString('reason') ?? '');
  await say(r.text, !r.ok);
}

/** "thanks @someone" gives the people mentioned rep (each counts against the giver's cooldown). */
export async function onThanksMessage(ctx: ModuleContext, m: Message): Promise<void> {
  if (!m.inGuild() || m.author.bot || !m.member || !m.mentions.users.size) return;
  const c = ctx.config(m.guild.id).reputation;
  if (!c.enabled || !c.thanks || !isThanks(m.content)) return;
  const target = m.mentions.members?.find((x) => !x.user.bot && x.id !== m.author.id);
  if (!target) return;
  const r = await give(ctx, m.guild, m.member, target, 'said thanks');
  if (r.ok) await m.react('⭐').catch(() => null);
}
