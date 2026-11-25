import { renderTemplate } from '@delyforge/shared';
import { type ChatInputCommandInteraction, type Guild, type GuildMember, type Invite, MessageFlags } from 'discord.js';
import { BRAND_COLOR, type ModuleContext, SAFE_MENTIONS, sendableChannel } from './context.js';
import { assignable } from './roles.js';

export const INVITE_COMMANDS = new Set(['invites', 'inviteboard']);

type Snapshot = Map<string, { uses: number; inviterId: string | null }>;

/** Each server's invite codes and how often they were used: the code whose count went up is the one just used. */
const snapshots = new Map<string, Snapshot>();

/** Which invite a new member used, by comparing invite use counts before and after they joined. */
export function findUsedInvite(before: Snapshot, after: Snapshot): { code: string; inviterId: string | null } | null {
  for (const [code, now] of after) {
    if (now.uses > (before.get(code)?.uses ?? 0)) return { code, inviterId: now.inviterId };
  }
  // A one-use invite disappears the moment it's used.
  const gone = [...before.keys()].filter((code) => !after.has(code));
  return gone.length === 1 ? { code: gone[0]!, inviterId: before.get(gone[0]!)!.inviterId } : null;
}

async function snapshot(guild: Guild): Promise<Snapshot | null> {
  const invites = await guild.invites.fetch().catch(() => null); // needs Manage Server
  return invites ? new Map(invites.map((i) => [i.code, { uses: i.uses ?? 0, inviterId: i.inviterId ?? null }])) : null;
}

/** Remembers current invite counts (on start and when the module is switched on). */
export async function syncInvites(ctx: ModuleContext, guild: Guild): Promise<void> {
  if (!ctx.config(guild.id).invites.enabled || snapshots.has(guild.id)) return;
  const s = await snapshot(guild);
  if (s) snapshots.set(guild.id, s);
  else ctx.log('warn', `Invite tracker: can’t read the invites of “${guild.name}” — give the bot the Manage Server permission.`);
}

export function onInviteCreate(invite: Invite): void {
  if (invite.guild) snapshots.get(invite.guild.id)?.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviterId ?? null });
}

export function onInviteDelete(invite: Invite): void {
  // Discord may delete a used-up one-use invite just before the member's join arrives, so forget it a little later.
  const guildId = invite.guild?.id;
  if (guildId) setTimeout(() => snapshots.get(guildId)?.delete(invite.code), 15_000).unref?.();
}

/** Works out who invited a new member, records it and announces it. Returns who invited them (for the join log). */
export async function onMemberJoin(ctx: ModuleContext, member: GuildMember): Promise<{ inviterId: string | null; code: string | null } | null> {
  const guild = member.guild;
  const config = ctx.config(guild.id).invites;
  if (!config.enabled || member.user.bot) return null;
  const before = snapshots.get(guild.id) ?? new Map();
  const after = await snapshot(guild);
  if (!after) return null;
  // shortcut: two members joining within the same second can be credited to the wrong invite; Discord gives no exact link.
  snapshots.set(guild.id, after);
  let used = findUsedInvite(before, after);
  if (!used && guild.vanityURLCode) used = { code: guild.vanityURLCode, inviterId: null };
  const count = ctx.store.recordInviteJoin(guild.id, member.id, used?.inviterId ?? null, used?.code ?? null);
  if (used?.inviterId) await giveInviteRewards(ctx, guild, used.inviterId);

  const channel = await sendableChannel(ctx, guild, config.channelId, 'Invite tracker');
  if (channel) {
    // Fits the default "{inviter}’s invite" wording: "the server’s invite" (custom link) or "someone’s invite".
    const inviter = used?.inviterId ? `<@${used.inviterId}>` : used?.code ? 'the server' : 'someone';
    await channel
      .send({ content: renderTemplate(config.message, { user: `<@${member.id}>`, inviter, invites: count, code: used?.code ?? '?' }), allowedMentions: SAFE_MENTIONS })
      .catch((e: Error) => ctx.log('warn', `Invite tracker: could not post: ${e.message}`));
  }
  return used ?? { inviterId: null, code: null };
}

/** Gives an inviter every reward role they've reached (counting invited members who are still here). */
export async function giveInviteRewards(ctx: ModuleContext, guild: Guild, inviterId: string): Promise<void> {
  const rewards = ctx.config(guild.id).invites.rewards;
  if (!rewards.length) return;
  const { stayed } = ctx.store.inviteCounts(guild.id, inviterId);
  const earned = rewards.filter((r) => stayed >= r.invites).map((r) => r.roleId);
  if (!earned.length) return;
  const inviter = await guild.members.fetch(inviterId).catch(() => null);
  if (!inviter) return;
  const add = assignable(inviter, earned).filter((r) => !inviter.roles.cache.has(r));
  if (add.length) await inviter.roles.add(add, `Invited ${stayed} members`).catch((e: Error) => ctx.log('warn', `Invite rewards: ${e.message}`));
}

export function onMemberLeave(ctx: ModuleContext, guildId: string, userId: string): void {
  if (ctx.config(guildId).invites.enabled) ctx.store.recordInviteLeave(guildId, userId);
}

export async function handleInvitesCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.guild) return;
  if (!ctx.config(i.guild.id).invites.enabled) {
    await i.reply({ content: 'The invite tracker isn’t enabled in this server.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (i.commandName === 'invites') {
    const user = i.options.getUser('member') ?? i.user;
    const { stayed, left } = ctx.store.inviteCounts(i.guild.id, user.id);
    const by = ctx.store.invitedBy(i.guild.id, user.id);
    const joined = !by ? 'Joined before invite tracking started.' : by.inviterId ? `Invited by <@${by.inviterId}>.` : by.code ? `Joined with the custom link \`${by.code}\`.` : 'Joined with an invite we couldn’t identify.';
    await i.reply({
      embeds: [{ title: `${user.username}’s invites`, description: `**${stayed}** member${stayed === 1 ? '' : 's'} invited${left ? ` (${left} more left since)` : ''}.\n${joined}`, color: BRAND_COLOR }],
      allowedMentions: { parse: [] },
    });
    return;
  }
  const top = ctx.store.inviteLeaderboard(i.guild.id, 10);
  if (!top.length) {
    await i.reply({ content: 'No tracked invites yet.', flags: MessageFlags.Ephemeral });
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  await i.reply({
    embeds: [
      {
        title: `📨 ${i.guild.name} — top inviters`,
        description: top.map((t, n) => `${medals[n] ?? `**${n + 1}.**`} <@${t.inviterId}> — ${t.stayed} invite${t.stayed === 1 ? '' : 's'}${t.left ? ` (${t.left} left)` : ''}`).join('\n'),
        color: BRAND_COLOR,
      },
    ],
    allowedMentions: { parse: [] },
  });
}
