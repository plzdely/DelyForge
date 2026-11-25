import type { GuildMember } from 'discord.js';
import { COLORS, type ModuleContext, sendableChannel, tryDM } from './context.js';

const DAY = 86_400_000;
/** Recent joins per server, and until when a detected raid lasts. */
const joins = new Map<string, { at: number; userId: string }[]>();
const raidUntil = new Map<string, number>();

/** Adds a join and returns the joins inside the window; a raid is when there are at least `threshold`. */
export function recordJoin(guildId: string, userId: string, now: number, perSeconds: number): { at: number; userId: string }[] {
  const list = (joins.get(guildId) ?? []).filter((j) => now - j.at < perSeconds * 1000);
  list.push({ at: now, userId });
  joins.set(guildId, list.slice(-200));
  return list;
}

async function alert(ctx: ModuleContext, member: GuildMember, title: string, description: string): Promise<void> {
  const channel = await sendableChannel(ctx, member.guild, ctx.config(member.guild.id).antiRaid.alertChannelId, 'Raid protection');
  await channel?.send({ embeds: [{ title, description, color: COLORS.danger, timestamp: new Date().toISOString() }], allowedMentions: { parse: [] } }).catch(() => null);
}

/** Runs first on every join. Returns true when the member was removed (so no welcome message is sent). */
export async function onMemberJoin(ctx: ModuleContext, member: GuildMember, now = Date.now()): Promise<boolean> {
  const guild = member.guild;
  const config = ctx.config(guild.id).antiRaid;
  if (!config.enabled || member.user.bot) return false;

  const ageDays = (now - member.user.createdTimestamp) / DAY;
  if (config.minAccountAgeDays && ageDays < config.minAccountAgeDays) {
    await tryDM(member.user, `You were removed from **${guild.name}** because your Discord account is newer than ${config.minAccountAgeDays} days. You’re welcome to join again once it’s older.`);
    const ok = await member
      .kick(`Raid protection: account younger than ${config.minAccountAgeDays} days`)
      .then(() => true)
      .catch((e: Error) => (ctx.log('warn', `Raid protection: could not kick ${member.user.tag}: ${e.message}`), false));
    if (ok) await alert(ctx, member, 'New account removed', `<@${member.id}> (${member.user.tag}) — account created <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>.`);
    return ok;
  }

  const wasRaid = (raidUntil.get(guild.id) ?? 0) > now;
  const recent = recordJoin(guild.id, member.id, now, config.perSeconds);
  if (!wasRaid && recent.length >= config.joinThreshold) {
    raidUntil.set(guild.id, now + config.raidMinutes * 60_000);
    const what = config.raidAction === 'alert' ? 'Nothing is done automatically' : `Everyone who joins in the next ${config.raidMinutes} minutes is ${config.raidAction === 'kick' ? 'kicked' : 'banned'}`;
    await alert(
      ctx,
      member,
      '🚨 Possible raid',
      `**${recent.length} members joined in ${config.perSeconds} seconds.** ${what}.\nRecent joins: ${recent.map((j) => `<@${j.userId}>`).join(' ')}`,
    );
    ctx.log('warn', `Raid protection: ${recent.length} joins in ${config.perSeconds}s in “${guild.name}”.`);
  }
  if ((raidUntil.get(guild.id) ?? 0) <= now || config.raidAction === 'alert') return false;

  const reason = 'Raid protection: joined during a raid';
  const done = await (config.raidAction === 'ban' ? member.ban({ reason }) : member.kick(reason)).then(
    () => true,
    (e: Error) => (ctx.log('warn', `Raid protection: could not remove ${member.user.tag}: ${e.message}`), false),
  );
  return done;
}
