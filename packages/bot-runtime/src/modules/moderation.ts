import {
  containsInvite,
  countEmoji,
  dehoistedName,
  isZalgo,
  disallowedLinks,
  isCapsSpam,
  matchBlockedWord,
  recordMessageAndCheckSpam,
  scamLinks,
  thresholdFor,
} from '@delyforge/shared';
import {
  type APIEmbed,
  AuditLogEvent,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  MessageFlags,
  type PartialGuildMember,
  PermissionFlagsBits,
} from 'discord.js';
import { COLORS, type ModuleContext, modLog, truncate, tryDM } from './context.js';
import { parseDuration } from './community.js';
import type { AuditLike } from './logging.js';

export const MODERATION_COMMANDS = new Set([
  'warn',
  'warnings',
  'clearwarnings',
  'unwarn',
  'history',
  'case',
  'note',
  'timeout',
  'untimeout',
  'kick',
  'ban',
  'unban',
  'purge',
  'lock',
  'unlock',
  'slowmode',
  'softban',
  'role',
  'nick',
  'lockdown',
  'unlockdown',
  'temprole',
  'reason',
  'modstats',
  'dehoist',
]);

/**
 * Locks or unlocks one channel for @everyone, remembering what it was so unlocking puts back exactly that
 * (e.g. an announcements channel stays read-only). Returns 'ok', 'already' (nothing to do) or an error message.
 */
async function setChannelLock(ctx: ModuleContext, guild: Guild, channel: GuildTextBasedChannel, locking: boolean, why: string): Promise<'ok' | 'already' | string> {
  if (!('permissionOverwrites' in channel) || channel.isThread()) return 'Pick a text channel.';
  const saved = ctx.store.channelLock(channel.id);
  if (locking === !!saved) return 'already';
  const current = channel.permissionOverwrites.cache.get(guild.id);
  const state = (bit: bigint, from: { allow: bigint; deny: bigint }) => ((from.allow & bit) !== 0n ? true : (from.deny & bit) !== 0n ? false : null);
  const LOCKED = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads] as const;
  const previous = saved ?? { allow: current?.allow.bitfield ?? 0n, deny: current?.deny.bitfield ?? 0n };
  const edits = Object.fromEntries((['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads'] as const).map((name, n) => [name, locking ? false : state(LOCKED[n]!, previous)]));
  try {
    await channel.permissionOverwrites.edit(guild.roles.everyone, edits, { reason: why });
  } catch (e) {
    return `Couldn’t change the channel: ${(e as Error).message}`;
  }
  if (locking) ctx.store.saveChannelLock(guild.id, channel.id, previous);
  else ctx.store.removeChannelLock(channel.id);
  return 'ok';
}

/** Removes leading symbols from a member's nickname (when dehoisting is on). True if it changed something. */
export async function dehoistMember(ctx: ModuleContext, member: GuildMember | PartialGuildMember): Promise<boolean> {
  if (member.partial || member.user.bot || !ctx.config(member.guild.id).moderation.enabled || !ctx.config(member.guild.id).moderation.dehoist) return false;
  const clean = dehoistedName(member.displayName);
  if (!clean || !member.manageable) return false;
  return member.setNickname(clean, 'Dehoist: names can’t start with symbols').then(() => true, () => false);
}

const CASE_LABELS: Record<string, string> = {
  warn: '⚠️ Warning',
  timeout: '⏳ Timeout',
  untimeout: '✅ Timeout removed',
  kick: '👢 Kick',
  ban: '🔨 Ban',
  tempban: '🔨 Temporary ban',
  softban: '🧹 Softban',
  unban: '✅ Unban',
  note: '📝 Note',
  automod: '🤖 Auto-moderation',
};

/** Records a numbered case and posts it to the moderation log. Returns the case number. */
async function logCase(
  ctx: ModuleContext,
  guild: Guild,
  c: { type: string; userId: string; moderatorId: string; reason: string; duration?: string | null },
  embed: APIEmbed,
): Promise<number> {
  const n = ctx.store.addCase({ guildId: guild.id, ...c });
  await modLog(ctx, guild, { ...embed, title: `Case #${n} · ${embed.title ?? CASE_LABELS[c.type] ?? c.type}` });
  return n;
}

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
  await logCase(
    ctx,
    guild,
    { type: t.action, userId: member.id, moderatorId: ctx.client.user.id, reason: why, duration: t.action === 'timeout' ? `${t.minutes}m` : null },
    { title: 'Automatic action', description: `<@${member.id}> was **${label}** — ${why}.`, color: COLORS.danger },
  );
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
  /** Warnings older than the expiry no longer count. */
  const since = config.warnExpiryDays ? Date.now() - config.warnExpiryDays * 86_400_000 : 0;
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
      const count = ctx.store.addWarning(guild.id, target.id, actor.id, reason, since);
      ctx.store.rememberName(guild.id, target.id, target.displayName);
      ctx.store.rememberName(guild.id, actor.id, actor.displayName);
      if (config.dmMembers) await tryDM(target.user, `You were warned in **${guild.name}**: ${reason}`);
      await logCase(
        ctx,
        guild,
        { type: 'warn', userId: target.id, moderatorId: actor.id, reason },
        { title: 'Member warned', description: `<@${target.id}> by <@${actor.id}>\n**Reason:** ${reason}\n**Warnings:** ${count}`, color: COLORS.warn },
      );
      const auto = await applyThreshold(ctx, guild, target, count);
      await reply(i, `⚠️ Warned **${target.displayName}** (${count} warning${count === 1 ? '' : 's'}).${auto ? ` They were automatically ${auto}.` : ''}`);
      return;
    }
    case 'warnings': {
      const user = i.options.getUser('member', true);
      const list = ctx.store.warnings(guild.id, user.id, since);
      if (!list.length) return void (await reply(i, `**${user.username}** has no${since ? ' active' : ''} warnings.`));
      const lines = list.map((w, n) => `**${n + 1}.** ${truncate(w.reason, 120)} — <@${w.moderatorId}>, <t:${Math.floor(Date.parse(w.createdAt) / 1000)}:R>`);
      await i.reply({
        embeds: [{ title: `Warnings for ${user.username} (${list.length})`, description: lines.join('\n'), color: COLORS.warn }],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    case 'history': {
      const user = i.options.getUser('member', true);
      const cases = ctx.store.cases(guild.id, user.id, 20);
      const warnings = ctx.store.warningCount(guild.id, user.id, since);
      if (!cases.length) return void (await reply(i, `**${user.username}** has a clean record.`));
      const lines = cases.map((c) => `**#${c.number}** ${CASE_LABELS[c.type] ?? c.type}${c.duration ? ` (${c.duration})` : ''} — ${truncate(c.reason, 100)} · <@${c.moderatorId}> <t:${Math.floor(c.createdAt / 1000)}:R>`);
      await i.reply({
        embeds: [{ title: `History for ${user.username}`, description: lines.join('\n'), footer: { text: `${cases.length} case(s) shown · ${warnings} active warning(s)` }, color: COLORS.info }],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    case 'case': {
      const c = ctx.store.caseByNumber(guild.id, i.options.getInteger('number', true));
      if (!c) return void (await reply(i, 'There’s no case with that number.'));
      await i.reply({
        embeds: [
          {
            title: `Case #${c.number} · ${CASE_LABELS[c.type] ?? c.type}`,
            description: `**Member:** <@${c.userId}>\n**By:** <@${c.moderatorId}>${c.duration ? `\n**Duration:** ${c.duration}` : ''}\n**Reason:** ${c.reason}\n**When:** <t:${Math.floor(c.createdAt / 1000)}:f>`,
            color: COLORS.info,
          },
        ],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    case 'note': {
      const user = i.options.getUser('member', true);
      const text = truncate(i.options.getString('text', true), 400);
      const n = await logCase(ctx, guild, { type: 'note', userId: user.id, moderatorId: actor.id, reason: text }, { description: `<@${user.id}> by <@${actor.id}>\n${text}`, color: COLORS.info });
      await reply(i, `📝 Saved as case #${n}. Only staff can see notes (\`/history\`).`);
      return;
    }
    case 'lock':
    case 'unlock': {
      const picked = i.options.getChannel('channel') ?? i.channel;
      const channel = picked ? guild.channels.cache.get(picked.id) : null;
      if (!channel || !channel.isTextBased() || !('permissionOverwrites' in channel) || channel.isThread()) return void (await reply(i, 'Pick a text channel.'));
      const locking = i.commandName === 'lock';
      // The moderator needs the rights in *this* channel, not just somewhere in the server.
      if (!channel.permissionsFor(actor)?.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
        return void (await reply(i, 'You need Manage Channels and Manage Permissions in that channel.'));
      }
      const result = await setChannelLock(ctx, guild, channel, locking, `${locking ? 'Locked' : 'Unlocked'} by ${actor.user.tag}: ${reason}`);
      if (result === 'already') return void (await reply(i, locking ? `<#${channel.id}> is already locked.` : `<#${channel.id}> wasn’t locked with /lock, so there’s nothing to undo.`));
      if (result !== 'ok') return void (await reply(i, result));
      if ('send' in channel) await channel.send({ content: locking ? `🔒 This channel is locked by staff. ${reason}` : '🔓 This channel is open again.', allowedMentions: { parse: [] } }).catch(() => null);
      await modLog(ctx, guild, { title: locking ? 'Channel locked' : 'Channel unlocked', description: `<#${channel.id}> by <@${actor.id}>${locking ? `\n**Reason:** ${reason}` : ''}`, color: locking ? COLORS.warn : COLORS.success });
      await reply(i, `${locking ? '🔒 Locked' : '🔓 Unlocked'} <#${channel.id}>.`);
      return;
    }
    case 'slowmode': {
      const channel = i.options.getChannel('channel') ?? i.channel;
      if (!channel || !('setRateLimitPerUser' in channel)) return void (await reply(i, 'Pick a text channel.'));
      if (!channel.permissionsFor(actor)?.has(PermissionFlagsBits.ManageChannels)) return void (await reply(i, 'You need Manage Channels in that channel.'));
      const seconds = i.options.getInteger('seconds', true);
      try {
        await channel.setRateLimitPerUser(seconds, `Slowmode set by ${actor.user.tag}`);
      } catch (e) {
        return void (await reply(i, `Couldn’t change the channel: ${(e as Error).message}`));
      }
      await modLog(ctx, guild, { title: 'Slowmode', description: `<#${channel.id}>: ${seconds ? `${seconds}s` : 'off'} — by <@${actor.id}>`, color: COLORS.info });
      await reply(i, seconds ? `🐢 Slowmode in <#${channel.id}>: one message every ${seconds}s.` : `Slowmode is off in <#${channel.id}>.`);
      return;
    }
    case 'unwarn': {
      const user = i.options.getUser('member', true);
      if (user.id === actor.id) return void (await reply(i, 'You can’t remove your own warnings.'));
      const member = await fetchTarget();
      const problem = member ? hierarchyProblem(guild, actor, member) : null;
      if (problem) return void (await reply(i, problem));
      // Numbers match /warnings (newest first, active ones only).
      const w = ctx.store.warnings(guild.id, user.id, since)[i.options.getInteger('number', true) - 1];
      if (!w || !ctx.store.removeWarning(guild.id, user.id, w.id)) return void (await reply(i, 'There’s no warning with that number — check /warnings.'));
      await modLog(ctx, guild, { title: 'Warning removed', description: `<@${user.id}>: “${truncate(w.reason, 200)}” removed by <@${actor.id}>.`, color: COLORS.info });
      return void (await reply(i, `Removed the warning “${truncate(w.reason, 80)}” from **${user.username}**.`));
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
      // Temporary ban: e.g. "3d" or "12h" (up to 30 days), lifted automatically.
      const durationText = i.commandName === 'ban' ? i.options.getString('duration')?.trim() || null : null;
      const durationMs = durationText ? parseDuration(durationText) : null;
      if (durationText && !durationMs) return void (await reply(i, 'Use a duration like 30m, 12h or 3d (up to 30 days).'));
      const until = durationMs ? Date.now() + durationMs : null;
      const banType = until ? 'tempban' : 'ban';
      const untilText = until ? ` until <t:${Math.floor(until / 1000)}:f>` : '';
      if (!target && i.commandName === 'ban') {
        // They already left (e.g. a raider) — Discord still allows banning by user ID; no roles to compare.
        const user = i.options.getUser('member', true);
        if (user.id === actor.id) return void (await reply(i, 'You can’t do that to yourself.'));
        try {
          await guild.bans.create(user.id, { reason: `${reason} (by ${actor.user.tag} · ${actor.id})`, deleteMessageSeconds: i.options.getInteger('delete_messages') ?? 0 });
        } catch (e) {
          return void (await reply(i, `Couldn’t ban: ${(e as Error).message}`));
        }
        // A permanent ban cancels any earlier temporary one, so it isn't lifted later.
        if (until) ctx.store.addTempBan(guild.id, user.id, until);
        else ctx.store.removeTempBan(guild.id, user.id);
        await logCase(ctx, guild, { type: banType, userId: user.id, moderatorId: actor.id, reason, duration: durationText }, {
          title: until ? 'Member temporarily banned' : 'Member banned',
          description: `<@${user.id}> (${user.tag}, not in the server) by <@${actor.id}>${untilText}\n**Reason:** ${reason}`,
          color: COLORS.danger,
        });
        return void (await reply(i, `✅ **${user.username}** was banned${untilText}.`));
      }
      if (!target) return void (await reply(i, 'That person isn’t in this server.'));
      const problem = hierarchyProblem(guild, actor, target);
      if (problem) return void (await reply(i, problem));
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const minutes = i.options.getInteger('minutes') ?? 0;
      const verb = i.commandName === 'timeout' ? `timed out for ${minutes} min` : i.commandName === 'kick' ? 'kicked' : `banned${untilText}`;
      const appeal = i.commandName === 'ban' && config.appealMessage.trim() ? `\n\n${config.appealMessage}` : '';
      if (config.dmMembers) await tryDM(target.user, `You were ${verb} in **${guild.name}**: ${reason}${appeal}`);
      try {
        if (i.commandName === 'timeout') await target.timeout(minutes * 60_000, `${reason} (by ${actor.user.tag} · ${actor.id})`);
        if (i.commandName === 'kick') await target.kick(`${reason} (by ${actor.user.tag} · ${actor.id})`);
        if (i.commandName === 'ban') {
          await target.ban({ reason: `${reason} (by ${actor.user.tag} · ${actor.id})`, deleteMessageSeconds: i.options.getInteger('delete_messages') ?? 0 });
        }
      } catch (e) {
        return void (await reply(i, `Couldn’t do that: ${(e as Error).message}`));
      }
      if (i.commandName === 'ban' && until) ctx.store.addTempBan(guild.id, target.id, until);
      else if (i.commandName === 'ban') ctx.store.removeTempBan(guild.id, target.id);
      const type = i.commandName === 'ban' ? banType : i.commandName;
      const n = await logCase(
        ctx,
        guild,
        { type, userId: target.id, moderatorId: actor.id, reason, duration: i.commandName === 'timeout' ? `${minutes}m` : durationText },
        { title: `Member ${verb.split(' ')[0]}`, description: `<@${target.id}> (${target.user.tag}) by <@${actor.id}>${i.commandName === 'ban' ? untilText : ''}\n**Reason:** ${reason}`, color: COLORS.danger },
      );
      await reply(i, `✅ **${target.displayName}** was ${verb}. (Case #${n})`);
      return;
    }
    case 'untimeout': {
      const target = await fetchTarget();
      if (!target) return void (await reply(i, 'That person isn’t in this server.'));
      const problem = hierarchyProblem(guild, actor, target);
      if (problem) return void (await reply(i, problem));
      await target.timeout(null, `Timeout removed by ${actor.user.tag}`).catch(() => null);
      await logCase(ctx, guild, { type: 'untimeout', userId: target.id, moderatorId: actor.id, reason }, { title: 'Timeout removed', description: `<@${target.id}> by <@${actor.id}>`, color: COLORS.info });
      await reply(i, `✅ Removed the timeout for **${target.displayName}**.`);
      return;
    }
    case 'unban': {
      const userId = i.options.getString('user_id', true).trim();
      if (!/^\d{17,20}$/.test(userId)) return void (await reply(i, 'That isn’t a valid user ID.'));
      try {
        await guild.bans.remove(userId, `${reason} (by ${actor.user.tag} · ${actor.id})`);
      } catch {
        return void (await reply(i, 'That user isn’t banned, or I don’t have permission to unban.'));
      }
      ctx.store.removeTempBan(guild.id, userId);
      await logCase(ctx, guild, { type: 'unban', userId, moderatorId: actor.id, reason }, { title: 'Member unbanned', description: `<@${userId}> by <@${actor.id}>\n**Reason:** ${reason}`, color: COLORS.success });
      await reply(i, `✅ Unbanned <@${userId}>.`);
      return;
    }
    case 'softban': {
      const target = await fetchTarget();
      if (!target) return void (await reply(i, 'That person isn’t in this server.'));
      const problem = hierarchyProblem(guild, actor, target);
      if (problem) return void (await reply(i, problem));
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (config.dmMembers) await tryDM(target.user, `You were removed from **${guild.name}** and your recent messages were deleted: ${reason}. You can join again.`);
      try {
        await guild.bans.create(target.id, { reason: `Softban: ${reason} (by ${actor.user.tag} · ${actor.id})`, deleteMessageSeconds: 7 * 86_400 });
        await guild.bans.remove(target.id, 'Softban: ban lifted straight away');
      } catch (e) {
        return void (await reply(i, `Couldn’t softban: ${(e as Error).message}`));
      }
      await logCase(ctx, guild, { type: 'softban', userId: target.id, moderatorId: actor.id, reason }, {
        title: 'Member softbanned',
        description: `<@${target.id}> by <@${actor.id}> — removed and their last 7 days of messages deleted\n**Reason:** ${reason}`,
        color: COLORS.danger,
      });
      return void (await reply(i, `🧹 **${target.displayName}** was removed and their recent messages were deleted.`));
    }
    case 'role': {
      const target = await fetchTarget();
      if (!target) return void (await reply(i, 'That person isn’t in this server.'));
      const role = i.options.getRole('role', true);
      const giving = i.options.getSubcommand() === 'give';
      const me = guild.members.me;
      if (role.id === guild.id || ('managed' in role && role.managed)) return void (await reply(i, 'That role can’t be given or taken by hand.'));
      if (actor.id !== guild.ownerId && role.position >= actor.roles.highest.position) return void (await reply(i, 'That role is the same as or above your highest role.'));
      if (!me || role.position >= me.roles.highest.position) return void (await reply(i, 'That role is above mine. Move my role higher in Server Settings → Roles.'));
      if (giving === target.roles.cache.has(role.id)) return void (await reply(i, giving ? `**${target.displayName}** already has <@&${role.id}>.` : `**${target.displayName}** doesn’t have <@&${role.id}>.`));
      try {
        if (giving) await target.roles.add(role.id, `By ${actor.user.tag}`);
        else await target.roles.remove(role.id, `By ${actor.user.tag}`);
      } catch (e) {
        return void (await reply(i, `Couldn’t change roles: ${(e as Error).message}`));
      }
      await modLog(ctx, guild, { title: giving ? 'Role given' : 'Role taken', description: `<@&${role.id}> ${giving ? 'given to' : 'taken from'} <@${target.id}> by <@${actor.id}>`, color: COLORS.info });
      return void (await reply(i, `${giving ? 'Gave' : 'Took'} <@&${role.id}> ${giving ? 'to' : 'from'} **${target.displayName}**.`));
    }
    case 'nick': {
      const target = await fetchTarget();
      if (!target) return void (await reply(i, 'That person isn’t in this server.'));
      const problem = target.id === actor.id ? null : hierarchyProblem(guild, actor, target);
      if (problem) return void (await reply(i, problem));
      const nickname = i.options.getString('nickname')?.trim() || null;
      try {
        await target.setNickname(nickname, `By ${actor.user.tag}`);
      } catch (e) {
        return void (await reply(i, `Couldn’t change the nickname: ${(e as Error).message}`));
      }
      return void (await reply(i, nickname ? `Renamed **${target.user.username}** to **${nickname}**.` : `Reset **${target.user.username}**’s nickname.`));
    }
    case 'purge': {
      const channel = i.channel;
      if (!channel || !('bulkDelete' in channel)) return void (await reply(i, 'This command only works in text channels.'));
      const amount = i.options.getInteger('amount', true);
      const only = i.options.getUser('member');
      const botsOnly = i.options.getBoolean('bots') ?? false;
      const linksOnly = i.options.getBoolean('links') ?? false;
      const filesOnly = i.options.getBoolean('attachments') ?? false;
      const contains = i.options.getString('contains')?.toLowerCase() ?? null;
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const recent = await channel.messages.fetch({ limit: 100 });
      const twoWeeks = Date.now() - 14 * 24 * 3600 * 1000 + 60_000; // Discord can’t bulk-delete older messages
      const targets = [...recent.values()]
        .filter(
          (m) =>
            (!only || m.author.id === only.id) &&
            (!botsOnly || m.author.bot) &&
            (!linksOnly || /https?:\/\//i.test(m.content)) &&
            (!filesOnly || m.attachments.size > 0) &&
            (!contains || m.content.toLowerCase().includes(contains)) &&
            m.createdTimestamp > twoWeeks,
        )
        .slice(0, amount);
      const deleted = await channel.bulkDelete(targets, true).catch(() => null);
      const n = deleted?.size ?? 0;
      await modLog(ctx, guild, { title: 'Messages purged', description: `${n} message(s) in <#${channel.id}> by <@${actor.id}>`, color: COLORS.info });
      await reply(i, `🧹 Deleted ${n} message${n === 1 ? '' : 's'}.${n < amount ? ' (Messages older than 14 days can’t be bulk-deleted.)' : ''}`);
      return;
    }
    case 'lockdown':
    case 'unlockdown': {
      if (!actor.permissions.has(PermissionFlagsBits.ManageGuild)) return void (await reply(i, 'You need Manage Server for this.'));
      const locking = i.commandName === 'lockdown';
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      // Lock channels everyone can talk in now; unlock every channel the bot locked.
      const everyone = guild.roles.everyone;
      const ids = locking
        ? [...guild.channels.cache.values()].filter((ch) => ch.isTextBased() && !ch.isThread() && !ch.isVoiceBased() && ch.permissionsFor(everyone).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])).map((ch) => ch.id)
        : ctx.store.channelLocks(guild.id);
      // shortcut: at most 50 channels per run (Discord rate limits); run it again for bigger servers.
      let changed = 0;
      for (const id of ids.slice(0, 50)) {
        const ch = guild.channels.cache.get(id);
        if (!ch?.isTextBased()) {
          if (!locking) ctx.store.removeChannelLock(id);
          continue;
        }
        if ((await setChannelLock(ctx, guild, ch, locking, `${locking ? 'Lockdown' : 'Lockdown lifted'} by ${actor.user.tag}: ${reason}`)) === 'ok') changed++;
      }
      await modLog(ctx, guild, { title: locking ? '🚨 Server lockdown' : '✅ Lockdown lifted', description: `${changed} channel(s) by <@${actor.id}>${locking ? `\n**Reason:** ${reason}` : ''}`, color: locking ? COLORS.danger : COLORS.success });
      await reply(i, locking ? `🚨 Locked ${changed} channel(s). Use /unlockdown to open them again.` : `✅ Unlocked ${changed} channel(s).`);
      return;
    }
    case 'temprole': {
      const target = await fetchTarget();
      if (!target) return void (await reply(i, 'That person isn’t in this server.'));
      const role = i.options.getRole('role', true);
      const ms = parseDuration(i.options.getString('duration', true));
      if (!ms) return void (await reply(i, 'Use a duration like `2h`, `1d` or `7d` (up to 30 days).'));
      const me = guild.members.me;
      if (role.managed || role.id === guild.id || !me || role.position >= me.roles.highest.position) return void (await reply(i, 'I can’t give that role — move my role above it.'));
      if (actor.id !== guild.ownerId && role.position >= actor.roles.highest.position) return void (await reply(i, 'That role is the same as or above your highest role.'));
      const given = await target.roles.add(role.id, `Temporary role from ${actor.user.tag}`).then(() => true, () => false);
      if (!given) return void (await reply(i, 'I couldn’t give that role.'));
      const until = Date.now() + ms;
      ctx.store.addTempRole(guild.id, target.id, role.id, until);
      await modLog(ctx, guild, { title: 'Temporary role', description: `<@${target.id}> got <@&${role.id}> until <t:${Math.floor(until / 1000)}:f> — by <@${actor.id}>`, color: COLORS.info });
      await reply(i, `Gave <@${target.id}> <@&${role.id}> — it’s taken back <t:${Math.floor(until / 1000)}:R>.`);
      return;
    }
    case 'reason': {
      const number = i.options.getInteger('case', true);
      const text = truncate(i.options.getString('reason', true), 400);
      const existing = ctx.store.caseByNumber(guild.id, number);
      if (!existing) return void (await reply(i, `There’s no case #${number}.`));
      if (existing.moderatorId !== actor.id && !actor.permissions.has(PermissionFlagsBits.ManageGuild)) return void (await reply(i, 'Only the moderator who made the case (or Manage Server) can change it.'));
      ctx.store.setCaseReason(guild.id, number, text);
      await modLog(ctx, guild, { title: `Case #${number} updated`, description: `New reason by <@${actor.id}>: ${text}`, color: COLORS.info });
      await reply(i, `Updated case #${number}.`);
      return;
    }
    case 'modstats': {
      const mod = i.options.getUser('moderator') ?? i.user;
      const all = ctx.store.casesByModerator(guild.id, mod.id);
      const month = ctx.store.casesByModerator(guild.id, mod.id, Date.now() - 30 * 86_400_000);
      const line = (counts: Record<string, number>) => Object.entries(counts).map(([t, n]) => `${CASE_LABELS[t] ?? t}: **${n}**`).join('\n') || 'Nothing yet';
      await i.reply({ embeds: [{ title: `🛡️ ${mod.username}’s moderation`, color: COLORS.info, fields: [{ name: 'Last 30 days', value: line(month), inline: true }, { name: 'All time', value: line(all), inline: true }] }], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    case 'dehoist': {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await guild.members.fetch().catch(() => null);
      let n = 0;
      for (const m of guild.members.cache.values()) {
        if (n >= 100) break; // shortcut: 100 renames per run keeps clear of rate limits; run it again if needed.
        const clean = m.user.bot ? null : dehoistedName(m.displayName);
        if (clean && m.manageable && (await m.setNickname(clean, `Dehoisted by ${actor.user.tag}`).then(() => true, () => false))) n++;
      }
      await reply(i, n ? `Fixed ${n} nickname(s).` : 'No hoisted nicknames found.');
      return;
    }
  }
}

/** Every 15 s: takes back temporary roles whose time is up. */
export async function endTempRoles(ctx: ModuleContext, client: Client): Promise<void> {
  for (const t of ctx.store.takeDueTempRoles(Date.now())) {
    const guild = client.guilds.cache.get(t.guildId);
    const member = await guild?.members.fetch(t.userId).catch(() => null);
    await member?.roles.remove(t.roleId, 'Temporary role ended').catch((e: Error) => ctx.log('warn', `Temporary role: could not remove: ${e.message}`));
  }
}

// ─── Auto-moderation ──────────────────────────────────────────────────────────────────────────────────────────────

const recent = new Map<string, number[]>();
/** Last message per member, for the repeated-message rule. */
const lastMessage = new Map<string, { text: string; count: number; at: number }>();

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
  // Staff, exempt roles and exempt channels (threads follow their channel) are never auto-moderated.
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
  if (member.roles.cache.some((r) => a.exemptRoleIds.includes(r.id))) return;
  const channelId = message.channel.isThread() ? (message.channel.parentId ?? message.channelId) : message.channelId;
  if (a.exemptChannelIds.includes(channelId)) return;

  const text = message.content;
  let rule: { label: string; action: 'delete' | 'warn' | 'timeout' } | null = null;
  const mentions = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
  const repeatKey = `${message.guild.id}:${member.id}`;
  const normalized = text.trim().toLowerCase();
  const last = lastMessage.get(repeatKey);
  const repeats = normalized && last && last.text === normalized && Date.now() - last.at < 60_000 ? last.count + 1 : 1;
  lastMessage.set(repeatKey, { text: normalized, count: repeats, at: Date.now() });
  if (lastMessage.size > 5000) for (const [k, v] of lastMessage) if (Date.now() - v.at > 60_000) lastMessage.delete(k);

  if (a.invites.enabled && containsInvite(text)) rule = { label: 'posting server invites', action: a.invites.action };
  else if (a.scams.enabled && scamLinks(text).length) rule = { label: 'posting a scam link', action: a.scams.action };
  else if (a.mentions.enabled && mentions > a.mentions.max) rule = { label: 'mentioning too many people', action: a.mentions.action };
  else if (a.links.enabled && disallowedLinks(text, a.links.allowedDomains).length) rule = { label: 'posting links', action: a.links.action };
  else if (a.words.enabled && matchBlockedWord(text, a.words.words)) rule = { label: 'using a blocked word', action: a.words.action };
  else if (a.caps.enabled && isCapsSpam(text, a.caps.minLength, a.caps.percent)) rule = { label: 'writing in all caps', action: a.caps.action };
  else if (a.emoji.enabled && countEmoji(text) > a.emoji.max) rule = { label: 'sending too many emoji', action: a.emoji.action };
  else if (a.zalgo.enabled && isZalgo(text)) rule = { label: 'using glitched (zalgo) text', action: a.zalgo.action };
  else if (a.lines.enabled && text.split('\n').length > a.lines.max) rule = { label: 'sending too many lines', action: a.lines.action };
  else if (a.newMemberLinks.enabled && member.joinedTimestamp && Date.now() - member.joinedTimestamp < a.newMemberLinks.hours * 3_600_000 && /https?:\/\/|discord\.gg\//i.test(text)) {
    rule = { label: 'posting links as a new member', action: a.newMemberLinks.action };
  }
  else if (a.repeats.enabled && repeats >= a.repeats.count) {
    rule = { label: 'repeating the same message', action: a.repeats.action };
    lastMessage.delete(repeatKey);
  } else if (a.spam.enabled) {
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
    ctx.store.rememberName(message.guild.id, member.id, member.displayName);
    const auto = await applyThreshold(ctx, message.guild, member, count);
    extra = ` and warned (${count})${auto ? `, then ${auto}` : ''}`;
  }
  const notice = await message.channel
    .send({ content: `<@${member.id}>, your message was removed for ${rule.label}.`, allowedMentions: { users: [member.id] } })
    .catch(() => null);
  if (notice) setTimeout(() => void notice.delete().catch(() => null), 6000);
  await logCase(
    ctx,
    message.guild,
    { type: 'automod', userId: member.id, moderatorId: ctx.client.user.id, reason: `${rule.label}${extra}` },
    { title: 'Auto-moderation', description: `Message by <@${member.id}> in <#${message.channel.id}> removed for **${rule.label}**${extra}.\n>>> ${truncate(text, 900) || '(no text)'}`, color: COLORS.warn },
  );
}

// ─── Temporary bans and actions taken outside DelyForge ───────────────────────────────────────────────────────────

/** Lifts temporary bans whose time is up (runs every 15 seconds; survives restarts because end times are stored). */
export async function endTempBans(ctx: ModuleContext, client: Client): Promise<void> {
  for (const due of ctx.store.dueTempBans(Date.now())) {
    ctx.store.removeTempBan(due.guildId, due.userId);
    const guild = client.guilds.cache.get(due.guildId);
    if (!guild) continue;
    const lifted = await guild.bans.remove(due.userId, 'Temporary ban ended').then(
      () => true,
      () => false, // already unbanned by hand
    );
    if (lifted) {
      await logCase(ctx, guild, { type: 'unban', userId: due.userId, moderatorId: ctx.client.user.id, reason: 'Temporary ban ended' }, { title: 'Temporary ban ended', description: `<@${due.userId}> can join again.`, color: COLORS.success });
    }
  }
}

/**
 * Bans, kicks and timeouts done with Discord's own buttons (not DelyForge commands) still get a case, so /history is
 * complete. Taken from the live audit log; DelyForge's own actions are already recorded when they happen.
 */
export async function onAuditCase(ctx: ModuleContext, e: AuditLike, guild: Guild): Promise<void> {
  if (!ctx.config(guild.id).moderation.enabled || !e.executorId || !e.targetId || e.executorId === ctx.client.user.id) return;
  let type: string | null = null;
  let duration: string | null = null;
  if (e.action === AuditLogEvent.MemberBanAdd) {
    type = 'ban';
    ctx.store.removeTempBan(guild.id, e.targetId); // banned again by hand: no automatic unban
  }
  else if (e.action === AuditLogEvent.MemberBanRemove) {
    type = 'unban';
    ctx.store.removeTempBan(guild.id, e.targetId);
  } else if (e.action === AuditLogEvent.MemberKick) type = 'kick';
  else if (e.action === AuditLogEvent.MemberUpdate) {
    const t = e.changes.find((c) => c.key === 'communication_disabled_until');
    if (t) {
      type = t.new ? 'timeout' : 'untimeout';
      if (typeof t.new === 'string') duration = `${Math.max(1, Math.round((Date.parse(t.new) - Date.now()) / 60_000))}m`;
    }
  }
  if (!type) return;
  const reason = e.reason ?? 'No reason given';
  await logCase(ctx, guild, { type, userId: e.targetId, moderatorId: e.executorId, reason, duration }, {
    title: `${CASE_LABELS[type] ?? type} (in Discord)`,
    description: `<@${e.targetId}> by <@${e.executorId}>\n**Reason:** ${truncate(reason, 400)}`,
    color: type === 'unban' || type === 'untimeout' ? COLORS.success : COLORS.danger,
  });
}
