import { randomInt } from 'node:crypto';
import { levelFromXp, renderTemplate } from '@delyforge/shared';
import { type ChatInputCommandInteraction, type Message, MessageFlags } from 'discord.js';
import { BRAND_COLOR, type ModuleContext, sendableChannel } from './context.js';
import { assignable } from './roles.js';

export const LEVELING_COMMANDS = new Set(['rank', 'leaderboard']);

/** Reward roles a member should have at `level`: all earned ones, or only the highest when rewards don't stack. */
export function rewardRolesFor(rewards: readonly { level: number; roleId: string }[], level: number, stack: boolean): { keep: string[]; drop: string[] } {
  const earned = rewards.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  const keep = stack ? earned.map((r) => r.roleId) : earned.slice(-1).map((r) => r.roleId);
  const drop = rewards.map((r) => r.roleId).filter((id) => !keep.includes(id));
  return { keep, drop: [...new Set(drop)] };
}

export async function onMessageXp(ctx: ModuleContext, message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || !message.member) return;
  const c = ctx.config(message.guild.id).leveling;
  if (!c.enabled) return;
  if (c.noXpChannelIds.includes(message.channelId)) return;
  if (message.member.roles.cache.some((r) => c.noXpRoleIds.includes(r.id))) return;

  const gained = ctx.store.addXp(message.guild.id, message.author.id, randomInt(c.xpMin, c.xpMax + 1), Date.now(), c.cooldownSeconds * 1000);
  if (!gained) return; // still on cooldown
  ctx.store.rememberName(message.guild.id, message.author.id, message.member.displayName);
  const before = levelFromXp(gained.before).level;
  const after = levelFromXp(gained.after).level;
  if (after <= before) return;

  // Rewards
  if (c.rewards.length) {
    const { keep, drop } = rewardRolesFor(c.rewards, after, c.stackRewards);
    const add = assignable(message.member, keep).filter((r) => !message.member!.roles.cache.has(r));
    const remove = assignable(message.member, drop).filter((r) => message.member!.roles.cache.has(r));
    if (add.length) await message.member.roles.add(add, `Reached level ${after}`).catch((e: Error) => ctx.log('warn', `Leveling: could not add reward role: ${e.message}`));
    if (remove.length) await message.member.roles.remove(remove, `Reached level ${after}`).catch(() => null);
    if (assignable(message.member, keep).length < keep.length) ctx.log('warn', 'Leveling: some reward roles are above the bot’s role and can’t be given.');
  }

  if (c.levelUp.enabled && c.levelUp.message.trim()) {
    const channel = c.levelUp.channelId ? await sendableChannel(ctx, message.guild, c.levelUp.channelId, 'Level-up message') : message.channel;
    const text = renderTemplate(c.levelUp.message, {
      user: `<@${message.author.id}>`,
      'user.name': message.member.displayName,
      'user.id': message.author.id,
      level: after,
      server: message.guild.name,
      memberCount: message.guild.memberCount,
    });
    await channel?.send({ content: text, allowedMentions: { users: [message.author.id] } }).catch((e: Error) => ctx.log('warn', `Leveling: could not announce: ${e.message}`));
  }
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
  if (i.commandName === 'rank') {
    const user = i.options.getUser('member') ?? i.user;
    const { xp, rank } = ctx.store.xpOf(i.guild.id, user.id);
    const lv = levelFromXp(xp);
    await i.reply({
      embeds: [
        {
          title: `${user.username} — level ${lv.level}`,
          description: `${bar(lv.current, lv.needed)}  ${lv.current} / ${lv.needed} XP\nRank **#${rank}** · ${xp} XP total`,
          thumbnail: { url: user.displayAvatarURL({ size: 128 }) },
          color: BRAND_COLOR,
        },
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }
  const top = ctx.store.leaderboard(i.guild.id, 10);
  if (!top.length) {
    await i.reply({ content: 'Nobody has earned XP yet — start chatting!', flags: MessageFlags.Ephemeral });
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  await i.reply({
    embeds: [
      {
        title: `🏆 ${i.guild.name} leaderboard`,
        description: top.map((t, n) => `${medals[n] ?? `**${n + 1}.**`} <@${t.userId}> — level ${levelFromXp(t.xp).level} · ${t.xp} XP`).join('\n'),
        color: BRAND_COLOR,
      },
    ],
    allowedMentions: { parse: [] },
  });
}
