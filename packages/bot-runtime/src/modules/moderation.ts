import {
  containsInvite,
  disallowedLinks,
  matchBlockedWord,
  recordMessageAndCheckSpam,
  thresholdFor,
} from '@delyforge/shared';
import {
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { COLORS, type ModuleContext, modLog, truncate, tryDM } from './context.js';

export const MODERATION_COMMANDS = new Set(['warn', 'warnings', 'clearwarnings', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge']);

const reply = (i: ChatInputCommandInteraction, content: string) =>
  i.replied || i.deferred
    ? i.editReply({ content, allowedMentions: { parse: [] } })
    : i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/**
 * Can `actor` act on `target`? Mirrors Discord's own rules so we fail with a clear message instead of an API error:
 * nobody can act on the owner or themselves, and both the moderator and the bot must be above the target.
 */
export function hierarchyProblem(
  guild: Pick<Guild, 'ownerId'> & { members: { me: Pick<GuildMember, 'id' | 'roles'> | null } },
  actor: Pick<GuildMember, 'id' | 'roles'>,
  target: Pick<GuildMember, 'id' | 'roles'>,
): string | null {
  if (target.id === actor.id) return 'You can’t do that to yourself.';
  if (target.id === guild.ownerId) return 'You can’t do that to the server owner.';
  if (target.id === guild.members.me?.id) return 'I can’t do that to myself.';
  if (actor.id !== guild.ownerId && target.roles.highest.position >= actor.roles.highest.position) {
    return 'That member’s highest role is the same as or above yours.';
  }
  const me = guild.members.me;
  if (me && target.roles.highest.position >= me.roles.highest.position) {
    return 'That member’s highest role is above mine. Move my role higher in Server Settings → Roles.';
  }
  return null;
}

async function applyThreshold(ctx: ModuleContext, guild: Guild, member: GuildMember, count: number): Promise<string | null> {
  const t = thresholdFor(ctx.config(guild.id).moderation.thresholds, count);
  if (!t) return null;
  const why = `Reached ${count} warnings`;
  try {
    if (t.action === 'timeout') await member.timeout(t.minutes * 60_000, why);
    if (t.action === 'kick') await member.kick(why);
    if (t.action === 'ban') await member.ban({ reason: why });
  } catch (e) {
    ctx.log('warn', `Moderation: automatic ${t.action} failed: ${(e as Error).message}`);
    return null;
  }
  const label = t.action === 'timeout' ? `timed out for ${t.minutes} min` : t.action === 'kick' ? 'kicked' : 'banned';
  await modLog(ctx, guild, {
    title: 'Automatic action',
    description: `<@${member.id}> was **${label}** — ${why}.`,
    color: COLORS.danger,
  });
  return label;
}

export async function handleModerationCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  const guild = i.guild;
  if (!guild) return;
  const config = ctx.config(guild.id).moderation;
  if (!config.enabled) {
    await reply(i, 'Moderation isn’t enabled in this server. An admin can turn it on in DelyForge.');
    return;
  }
  const actor = await guild.members.fetch(i.user.id);
  const reason = truncate(i.options.getString('reason') ?? 'No reason given', 400);
  /** The member, or null only when Discord says they're not in the server (any other error fails closed). */
  const fetchTarget = async (name = 'member') => {
    const user = i.options.getUser(name, true);
    try {
      return await guild.members.fetch(user.id);
    } catch (e) {
      if ((e as { code?: number }).code === 10007) return null; // Unknown Member
      throw e;
    }
  };

  switch (i.commandName) {
    case 'warn': {
      const target = await fetchTarget();
      if (!target) return void (await reply(i, 'That person isn’t in this server.'));
      const problem = hierarchyProblem(guild, actor, target);
      if (problem) return void (await reply(i, problem));
      const count = ctx.store.addWarning(guild.id, target.id, actor.id, reason);
      if (config.dmMembers) await tryDM(target.user, `You were warned in **${guild.name}**: ${reason}`);
      await modLog(ctx, guild, { title: 'Member warned', description: `<@${target.id}> by <@${actor.id}>\n**Reason:** ${reason}\n**Warnings:** ${count}`, color: COLORS.warn });
      const auto = await applyThreshold(ctx, guild, target, count);
      await reply(i, `⚠️ Warned **${target.displayName}** (${count} warning${count === 1 ? '' : 's'}).${auto ? ` They were automatically ${auto}.` : ''}`);
      return;
    }
    case 'warnings': {
      const user = i.options.getUser('member', true);
      const list = ctx.store.warnings(guild.id, user.id);
      if (!list.length) return void (await reply(i, `**${user.username}** has no warnings.`));
      const lines = list.map((w, n) => `**${n + 1}.** ${truncate(w.reason, 120)} — <@${w.moderatorId}>, <t:${Math.floor(Date.parse(w.createdAt) / 1000)}:R>`);
      await i.reply({
        embeds: [{ title: `Warnings for ${user.username} (${list.length})`, description: lines.join('\n'), color: COLORS.warn }],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    case 'clearwarnings': {
      const user = i.options.getUser('member', true);
      if (user.id === actor.id) return void (await reply(i, 'You can’t clear your own warnings.'));
      const member = await fetchTarget();
      const problem = member ? hierarchyProblem(guild, actor, member) : null;
      if (problem) return void (await reply(i, problem));
      const removed = ctx.store.clearWarnings(guild.id, user.id);
      await modLog(ctx, guild, { title: 'Warnings cleared', description: `${removed} warning(s) for <@${user.id}> cleared by <@${actor.id}>.`, color: COLORS.info });
      await reply(i, `Cleared ${removed} warning${removed === 1 ? '' : 's'} for **${user.username}**.`);
      return;
    }
    case 'timeout':
    case 'kick':
    case 'ban': {
      const target = await fetchTarget();
      if (!target && i.commandName === 'ban') {
        // They already left (e.g. a raider) — Discord still allows banning by user ID; no roles to compare.
        const user = i.options.getUser('member', true);
        if (user.id === actor.id) return void (await reply(i, 'You can’t do that to yourself.'));
        try {
          await guild.bans.create(user.id, { reason: `${reason} (by ${actor.user.tag})`, deleteMessageSeconds: i.options.getInteger('delete_messages') ?? 0 });
        } catch (e) {
          return void (await reply(i, `Couldn’t ban: ${(e as Error).message}`));
        }
        await modLog(ctx, guild, { title: 'Member banned', description: `<@${user.id}> (${user.tag}, not in the server) by <@${actor.id}>
**Reason:** ${reason}`, color: COLORS.danger });
        return void (await reply(i, `✅ **${user.username}** was banned.`));
      }
      if (!target) return void (await reply(i, 'That person isn’t in this server.'));
      const problem = hierarchyProblem(guild, actor, target);
      if (problem) return void (await reply(i, problem));
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const minutes = i.options.getInteger('minutes') ?? 0;
      const verb = i.commandName === 'timeout' ? `timed out for ${minutes} min` : i.commandName === 'kick' ? 'kicked' : 'banned';
      if (config.dmMembers) await tryDM(target.user, `You were ${verb} in **${guild.name}**: ${reason}`);
      try {
        if (i.commandName === 'timeout') await target.timeout(minutes * 60_000, `${reason} (by ${actor.user.tag})`);
        if (i.commandName === 'kick') await target.kick(`${reason} (by ${actor.user.tag})`);
        if (i.commandName === 'ban') {
          await target.ban({ reason: `${reason} (by ${actor.user.tag})`, deleteMessageSeconds: i.options.getInteger('delete_messages') ?? 0 });
        }
      } catch (e) {
        return void (await reply(i, `Couldn’t do that: ${(e as Error).message}`));
      }
      await modLog(ctx, guild, {
        title: `Member ${verb.split(' ')[0]}`,
        description: `<@${target.id}> (${target.user.tag}) by <@${actor.id}>\n**Reason:** ${reason}`,
        color: COLORS.danger,
      });
      await reply(i, `✅ **${target.displayName}** was ${verb}.`);
      return;
    }
    case 'untimeout': {
      const target = await fetchTarget();
      if (!target) return void (await reply(i, 'That person isn’t in this server.'));
      const problem = hierarchyProblem(guild, actor, target);
      if (problem) return void (await reply(i, problem));
      await target.timeout(null, `Timeout removed by ${actor.user.tag}`).catch(() => null);
      await modLog(ctx, guild, { title: 'Timeout removed', description: `<@${target.id}> by <@${actor.id}>`, color: COLORS.info });
      await reply(i, `✅ Removed the timeout for **${target.displayName}**.`);
      return;
    }
    case 'unban': {
      const userId = i.options.getString('user_id', true).trim();
      if (!/^\d{17,20}$/.test(userId)) return void (await reply(i, 'That isn’t a valid user ID.'));
      try {
        await guild.bans.remove(userId, `${reason} (by ${actor.user.tag})`);
      } catch {
        return void (await reply(i, 'That user isn’t banned, or I don’t have permission to unban.'));
      }
      await modLog(ctx, guild, { title: 'Member unbanned', description: `<@${userId}> by <@${actor.id}>\n**Reason:** ${reason}`, color: COLORS.success });
      await reply(i, `✅ Unbanned <@${userId}>.`);
      return;
    }
    case 'purge': {
      const channel = i.channel;
      if (!channel || !('bulkDelete' in channel)) return void (await reply(i, 'This command only works in text channels.'));
      const amount = i.options.getInteger('amount', true);
      const only = i.options.getUser('member');
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const recent = await channel.messages.fetch({ limit: 100 });
      const twoWeeks = Date.now() - 14 * 24 * 3600 * 1000 + 60_000; // Discord can’t bulk-delete older messages
      const targets = [...recent.values()].filter((m) => (!only || m.author.id === only.id) && m.createdTimestamp > twoWeeks).slice(0, amount);
      const deleted = await channel.bulkDelete(targets, true).catch(() => null);
      const n = deleted?.size ?? 0;
      await modLog(ctx, guild, { title: 'Messages purged', description: `${n} message(s) in <#${channel.id}> by <@${actor.id}>`, color: COLORS.info });
      await reply(i, `🧹 Deleted ${n} message${n === 1 ? '' : 's'}.${n < amount ? ' (Messages older than 14 days can’t be bulk-deleted.)' : ''}`);
      return;
    }
  }
}

// ─── Auto-moderation ──────────────────────────────────────────────────────────────────────────────────────────────

const recent = new Map<string, number[]>();

/** Forgets members with no messages inside the spam window, so memory doesn't grow with every member ever seen. */
function pruneSpamTracker(now: number, perSeconds: number): void {
  for (const [key, ts] of recent) if (!ts.length || ts[ts.length - 1]! < now - perSeconds * 1000) recent.delete(key);
}

/** Checks a message against the auto-moderation rules and acts on the first one it breaks. */
export async function automodCheck(ctx: ModuleContext, message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || !message.member) return;
  const config = ctx.config(message.guild.id).moderation;
  if (!config.enabled || !config.automod.enabled) return;
  const a = config.automod;
  const member = message.member;
  // Staff and exempt roles are never auto-moderated.
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
  if (member.roles.cache.some((r) => a.exemptRoleIds.includes(r.id))) return;

  const text = message.content;
  let rule: { label: string; action: 'delete' | 'warn' | 'timeout' } | null = null;
  if (a.invites.enabled && containsInvite(text)) rule = { label: 'posting server invites', action: a.invites.action };
  else if (a.links.enabled && disallowedLinks(text, a.links.allowedDomains).length) rule = { label: 'posting links', action: a.links.action };
  else if (a.words.enabled && matchBlockedWord(text, a.words.words)) rule = { label: 'using a blocked word', action: a.words.action };
  else if (a.spam.enabled) {
    const key = `${message.guild.id}:${member.id}`;
    const ts = recent.get(key) ?? [];
    recent.set(key, ts);
    if (recordMessageAndCheckSpam(ts, Date.now(), a.spam.maxMessages, a.spam.perSeconds)) {
      rule = { label: 'sending messages too fast', action: a.spam.action };
      ts.length = 0;
    }
    if (recent.size > 5000) pruneSpamTracker(Date.now(), a.spam.perSeconds);
  }
  if (!rule) return;

  await message.delete().catch(() => null);
  let extra = '';
  if (rule.action === 'timeout') {
    await member.timeout(a.timeoutMinutes * 60_000, `Auto-moderation: ${rule.label}`).catch((e: Error) => ctx.log('warn', `Auto-mod timeout failed: ${e.message}`));
    extra = ` and timed out for ${a.timeoutMinutes} min`;
  } else if (rule.action === 'warn') {
    const count = ctx.store.addWarning(message.guild.id, member.id, ctx.client.user.id, `Auto-moderation: ${rule.label}`);
    const auto = await applyThreshold(ctx, message.guild, member, count);
    extra = ` and warned (${count})${auto ? `, then ${auto}` : ''}`;
  }
  const notice = await message.channel
    .send({ content: `<@${member.id}>, your message was removed for ${rule.label}.`, allowedMentions: { users: [member.id] } })
    .catch(() => null);
  if (notice) setTimeout(() => void notice.delete().catch(() => null), 6000);
  await modLog(ctx, message.guild, {
    title: 'Auto-moderation',
    description: `Message by <@${member.id}> in <#${message.channel.id}> removed for **${rule.label}**${extra}.\n>>> ${truncate(text, 900) || '(no text)'}`,
    color: COLORS.warn,
  });
}
