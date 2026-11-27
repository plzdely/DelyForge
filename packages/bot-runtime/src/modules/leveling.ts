import { randomInt } from 'node:crypto';
import { levelFromXp, renderTemplate } from '@delyforge/shared';
import { type ChatInputCommandInteraction, type Guild, type GuildMember, type GuildTextBasedChannel, type Message, MessageFlags } from 'discord.js';
import { BRAND_COLOR, type ModuleContext, sendableChannel, tryDM } from './context.js';
import { assignable } from './roles.js';

export const LEVELING_COMMANDS = new Set(['rank', 'leaderboard', 'xp', 'rewards']);

/** Reward roles a member should have at `level`: all earned ones, or only the highest when rewards don't stack. */
export function rewardRolesFor(rewards: readonly { level: number; roleId: string }[], level: number, stack: boolean): { keep: string[]; drop: string[] } {
  const earned = rewards.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  const keep = stack ? earned.map((r) => r.roleId) : earned.slice(-1).map((r) => r.roleId);
  const drop = rewards.map((r) => r.roleId).filter((id) => !keep.includes(id));
  return { keep, drop: [...new Set(drop)] };
}

/** The biggest XP boost from a member's roles (1 = none). */
export function xpMultiplier(multipliers: readonly { roleId: string; multiplier: number }[], roleIds: Iterable<string>): number {
  const has = new Set(roleIds);
  return multipliers.reduce((best, m) => (has.has(m.roleId) ? Math.max(best, m.multiplier) : best), 1);
}

export async function onMessageXp(ctx: ModuleContext, message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || !message.member) return;
  const c = ctx.config(message.guild.id).leveling;
  if (!c.enabled) return;
  if (c.noXpChannelIds.includes(message.channelId)) return;
  if (message.member.roles.cache.some((r) => c.noXpRoleIds.includes(r.id))) return;
  // Channel boosts (threads count as their channel).
  const channelId = message.channel.isThread() ? (message.channel.parentId ?? message.channelId) : message.channelId;
  const boost = c.channelMultipliers.reduce((best, m) => (m.channelId === channelId ? Math.max(best, m.multiplier) : best), 1);
  await grantXp(ctx, message.member, randomInt(c.xpMin, c.xpMax + 1) * boost, c.cooldownSeconds * 1000, message.channel);
}

/** Voice XP, once a minute: members talking with at least one other person (not deafened, not in a no-XP channel). */
export async function voiceXp(ctx: ModuleContext, guild: Guild): Promise<void> {
  const c = ctx.config(guild.id).leveling;
  if (!c.enabled || !c.voiceXpPerMinute) return;
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isVoiceBased() || channel.id === guild.afkChannelId || c.noXpChannelIds.includes(channel.id)) continue;
    const people = channel.members.filter((m) => !m.user.bot);
    if (people.size < 2) continue;
    for (const m of people.values()) {
      if (m.voice.selfDeaf || m.voice.serverDeaf || m.roles.cache.some((r) => c.noXpRoleIds.includes(r.id))) continue;
      await grantXp(ctx, m, c.voiceXpPerMinute, 0, null);
    }
  }
}

/** Adds XP (with role boosts), then handles level-ups: reward roles and the announcement. */
async function grantXp(ctx: ModuleContext, member: GuildMember, base: number, cooldownMs: number, here: GuildTextBasedChannel | null): Promise<void> {
  const guild = member.guild;
  const c = ctx.config(guild.id).leveling;
  const weekend = c.weekendDoubleXp && [0, 6].includes(new Date().getUTCDay()) ? 2 : 1;
  const amount = Math.round(base * weekend * xpMultiplier(c.multipliers, member.roles.cache.keys()));
  const gained = ctx.store.addXp(guild.id, member.id, amount, Date.now(), cooldownMs);
  if (!gained) return; // still on cooldown
  ctx.store.rememberName(guild.id, member.id, member.displayName);
  await afterXpChange(ctx, member, gained.before, gained.after, here);
}

/** Reward roles and the level-up message when a member's level went up (also used by /xp). */
async function afterXpChange(ctx: ModuleContext, member: GuildMember, beforeXp: number, afterXp: number, here: GuildTextBasedChannel | null): Promise<void> {
  const c = ctx.config(member.guild.id).leveling;
  const before = levelFromXp(beforeXp).level;
  const after = levelFromXp(afterXp).level;
  if (after === before) return;

  // Rewards (also taken back when /xp lowers someone's level)
  if (c.rewards.length) {
    const { keep, drop } = rewardRolesFor(c.rewards, after, c.stackRewards);
    const add = assignable(member, keep).filter((r) => !member.roles.cache.has(r));
    const remove = assignable(member, drop).filter((r) => member.roles.cache.has(r));
    if (add.length) await member.roles.add(add, `Reached level ${after}`).catch((e: Error) => ctx.log('warn', `Leveling: could not add reward role: ${e.message}`));
    if (remove.length) await member.roles.remove(remove, `Level ${after}`).catch(() => null);
    if (assignable(member, keep).length < keep.length) ctx.log('warn', 'Leveling: some reward roles are above the bot’s role and can’t be given.');
  }

  if (after < before || !c.levelUp.enabled || !c.levelUp.message.trim() || after % c.announceEvery !== 0) return;
  const text = renderTemplate(c.levelUp.message, {
    user: `<@${member.id}>`,
    'user.name': member.displayName,
    'user.id': member.id,
    level: after,
    server: member.guild.name,
    memberCount: member.guild.memberCount,
  });
  if (c.levelUp.dm) return void (await tryDM(member.user, text));
  const channel = c.levelUp.channelId ? await sendableChannel(ctx, member.guild, c.levelUp.channelId, 'Level-up message') : here;
  const payload = c.levelUp.embed
    ? { content: `<@${member.id}>`, embeds: [{ title: `⬆️ Level ${after}`, description: text, thumbnail: { url: member.user.displayAvatarURL({ size: 128 }) }, color: member.displayColor || 0x7c5cff }], allowedMentions: { users: [member.id] } }
    : { content: text, allowedMentions: { users: [member.id] } };
  await channel?.send(payload).catch((e: Error) => ctx.log('warn', `Leveling: could not announce: ${e.message}`));
}

/** /xp give|take|set — staff tools. */
async function handleXpCommand(ctx: ModuleContext, i: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (i.options.getSubcommand() === 'resetall') {
    if (!i.member.permissions.has('ManageGuild')) return void (await i.reply({ content: 'Only staff with Manage Server can do that.', flags: MessageFlags.Ephemeral }));
    if (i.options.getString('confirm', true) !== 'RESET') return void (await i.reply({ content: 'Type RESET (in capitals) to confirm — this wipes everyone’s XP.', flags: MessageFlags.Ephemeral }));
    const n = ctx.store.resetXp(i.guildId, null);
    ctx.log('warn', `Leveling: ${i.user.tag} reset everyone’s XP in “${i.guild.name}” (${n} members).`);
    return void (await i.reply({ content: `Reset XP for ${n} member(s). Reward roles stay until members level up again.`, flags: MessageFlags.Ephemeral }));
  }
  const user = i.options.getUser('member', true);
  const member = await i.guild.members.fetch(user.id).catch(() => null);
  if (!member || user.bot) return void (await i.reply({ content: 'Pick a member of this server (not a bot).', flags: MessageFlags.Ephemeral }));
  const amount = i.options.getInteger('amount', true);
  const sub = i.options.getSubcommand();
  const current = ctx.store.xpOf(i.guildId, user.id).xp;
  const { before, after } = ctx.store.setXp(i.guildId, user.id, sub === 'give' ? current + amount : sub === 'take' ? current - amount : amount);
  ctx.store.rememberName(i.guildId, user.id, member.displayName);
  await i.reply({
    content: `**${member.displayName}** now has ${after} XP (level ${levelFromXp(after).level}, was ${before} XP).`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
  await afterXpChange(ctx, member, before, after, null);
}

/** Leaving members lose their XP when "reset on leave" is on. */
export function onMemberLeaveXp(ctx: ModuleContext, guildId: string, userId: string): void {
  const c = ctx.config(guildId).leveling;
  if (c.enabled && c.resetOnLeave) ctx.store.resetXp(guildId, userId);
}

const bar = (current: number, needed: number) => {
  const filled = Math.round((current / needed) * 12);
  return `${'▰'.repeat(filled)}${'▱'.repeat(12 - filled)}`;
};

export async function handleLevelingCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.guild) return;
  if (!ctx.config(i.guild.id).leveling.enabled) {
    await i.reply({ content: 'Leveling isn’t enabled in this server.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (i.commandName === 'xp') return handleXpCommand(ctx, i as ChatInputCommandInteraction<'cached'>);
  if (i.commandName === 'rewards') {
    const rewards = [...ctx.config(i.guild.id).leveling.rewards].sort((a, b) => a.level - b.level);
    return void (await i.reply({
      embeds: [{ title: '🏅 Level rewards', description: rewards.length ? rewards.map((r) => `Level **${r.level}** → <@&${r.roleId}>`).join('\n') : 'There are no level rewards yet.', color: 0x7c5cff }],
      allowedMentions: { parse: [] },
    }));
  }
  if (i.commandName === 'rank') {
    const user = i.options.getUser('member') ?? i.user;
    const name = (await i.guild.members.fetch(user.id).catch(() => null))?.displayName ?? user.username;
    const { xp, rank } = ctx.store.xpOf(i.guild.id, user.id);
    const lv = levelFromXp(xp);
    await i.reply({
      embeds: [
        {
          title: `${name} — level ${lv.level}`,
          description: `${bar(lv.current, lv.needed)}  ${lv.current} / ${lv.needed} XP\nRank **#${rank}** · ${xp} XP total`,
          thumbnail: { url: user.displayAvatarURL({ size: 128 }) },
          color: BRAND_COLOR,
        },
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }
  const page = i.options.getInteger('page') ?? 1;
  const top = ctx.store.leaderboard(i.guild.id, 10, (page - 1) * 10);
  if (!top.length && page > 1) return void (await i.reply({ content: `There’s no page ${page}.`, flags: MessageFlags.Ephemeral }));
  if (!top.length) {
    await i.reply({ content: 'Nobody has earned XP yet — start chatting!', flags: MessageFlags.Ephemeral });
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  await i.reply({
    embeds: [
      {
        title: `🏆 ${i.guild.name} leaderboard${page > 1 ? ` — page ${page}` : ''}`,
        description: top.map((t, n) => `${(page === 1 && medals[n]) || `**${(page - 1) * 10 + n + 1}.**`} <@${t.userId}> — level ${levelFromXp(t.xp).level} · ${t.xp} XP`).join('\n'),
        footer: top.length === 10 ? { text: `Next: /leaderboard page:${page + 1}` } : undefined,
        color: BRAND_COLOR,
      },
    ],
    allowedMentions: { parse: [] },
  });
}
