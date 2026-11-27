import { renderTemplate } from '@delyforge/shared';
import type { Guild, GuildMember, PartialGuildMember } from 'discord.js';
import { type ModuleContext, SAFE_MENTIONS, sendableChannel, templateVars } from './context.js';
import { assignable } from './roles.js';

/** Member tools: roles and nickname back on rejoin, a welcome-back message, and roles for time in the server. */

export function onMemberLeaveSnapshot(ctx: ModuleContext, member: GuildMember | PartialGuildMember): void {
  const c = ctx.config(member.guild.id).memberTools;
  if (!c.enabled || member.partial || member.user.bot) return;
  const roles = member.roles.cache.filter((r) => r.id !== member.guild.id && !r.managed).map((r) => r.id);
  ctx.store.saveSnapshot(member.guild.id, member.id, roles, member.nickname, Date.now());
}

/** Returns true when it was a rejoin (so the normal welcome can be skipped if a welcome-back was sent). */
export async function onMemberRejoin(ctx: ModuleContext, member: GuildMember): Promise<boolean> {
  const c = ctx.config(member.guild.id).memberTools;
  if (!c.enabled || member.user.bot) return false;
  const snap = ctx.store.takeSnapshot(member.guild.id, member.id);
  if (!snap) return false;
  if (c.stickyRoles) {
    const back = assignable(member, snap.roles.filter((r) => !c.excludedRoleIds.includes(r)));
    if (back.length) await member.roles.add(back, 'Member tools: roles given back on rejoin').catch((e: Error) => ctx.log('warn', `Member tools: couldn’t give roles back: ${e.message}`));
    if (back.length) ctx.log('info', `Member tools: gave ${member.user.tag} ${back.length} role(s) back after rejoining.`);
  }
  if (c.stickyNickname && snap.nick && member.manageable) await member.setNickname(snap.nick, 'Member tools: nickname given back').catch(() => null);
  if (c.welcomeBack.enabled) {
    const channel = await sendableChannel(ctx, member.guild, c.welcomeBack.channelId, 'Welcome back');
    await channel?.send({ content: renderTemplate(c.welcomeBack.message, { ...templateVars(member), left: `<t:${Math.floor(snap.leftAt / 1000)}:R>` }), allowedMentions: SAFE_MENTIONS }).catch(() => null);
  }
  return c.welcomeBack.enabled;
}

/** Every 10 minutes: roles for time in the server. Needs the member list (Server Members intent). */
export async function giveTenureRoles(ctx: ModuleContext, guild: Guild, now = Date.now()): Promise<void> {
  const c = ctx.config(guild.id).memberTools;
  if (!c.enabled || !c.tenureRoles.length) return;
  await guild.members.fetch().catch(() => null);
  let given = 0;
  for (const m of guild.members.cache.values()) {
    if (m.user.bot || !m.joinedTimestamp) continue;
    const days = (now - m.joinedTimestamp) / 86_400_000;
    const due = assignable(m, c.tenureRoles.filter((t) => days >= t.days).map((t) => t.roleId)).filter((r) => !m.roles.cache.has(r));
    if (!due.length) continue;
    await m.roles.add(due, 'Member tools: time in the server').catch(() => null);
    if (++given >= 50) break; // shortcut: at most 50 members per run (rate limits); the rest get theirs 10 minutes later.
  }
}
