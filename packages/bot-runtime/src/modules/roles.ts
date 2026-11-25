import { randomInt } from 'node:crypto';
import { renderTemplate } from '@delyforge/shared';
import {
  type ButtonInteraction,
  ComponentType,
  type Guild,
  type GuildMember,
  MessageFlags,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  type StringSelectMenuInteraction,
  TextInputStyle,
} from 'discord.js';
import { COLORS, type ModuleContext, sendableChannel, templateVars, tryDM } from './context.js';

/** Roles the bot may give: exist, not managed by an integration, and below the bot's own highest role. */
export function assignable(member: GuildMember, roleIds: readonly string[]): string[] {
  const me = member.guild.members.me;
  return roleIds.filter((id) => {
    const role = member.guild.roles.cache.get(id);
    return role && !role.managed && me && role.position < me.roles.highest.position;
  });
}

/** Manage Server, or one of the given roles. */
export function isStaff(member: GuildMember, roleIds: readonly string[]): boolean {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) || member.roles.cache.some((r) => roleIds.includes(r.id));
}

type Reply = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
const ephemeral = (i: Reply, content: string) =>
  i.replied || i.deferred ? i.editReply({ content, allowedMentions: { parse: [] } }) : i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

// ─── Reaction roles ───────────────────────────────────────────────────────────────────────────────────────────────

/** A role button: toggles that role. The role must still be on the panel in the current settings. */
export async function onRoleButton(ctx: ModuleContext, i: ButtonInteraction, panelId: string, roleId: string): Promise<void> {
  if (!i.inCachedGuild()) return;
  const config = ctx.config(i.guildId).reactionRoles;
  const panel = config.enabled ? config.panels.find((p) => p.id === panelId) : undefined;
  if (!panel?.roles.some((r) => r.roleId === roleId)) return void (await ephemeral(i, 'This role panel is no longer active.'));
  if (panel.requiredRoleId && !i.member.roles.cache.has(panel.requiredRoleId)) return void (await ephemeral(i, `You need <@&${panel.requiredRoleId}> to use this panel.`));
  if (!assignable(i.member, [roleId]).length) {
    ctx.log('warn', `Reaction roles: can’t give <@&${roleId}> — move the bot’s role above it.`);
    return void (await ephemeral(i, 'I can’t give that role right now. Please tell a server admin.'));
  }
  if (i.member.roles.cache.has(roleId)) {
    await i.member.roles.remove(roleId, 'DelyForge reaction roles');
    return void (await ephemeral(i, `Removed <@&${roleId}>.`));
  }
  // One role only: swap out the others from this panel.
  const swapped = panel.oneRoleOnly ? assignable(i.member, panel.roles.map((r) => r.roleId)).filter((r) => r !== roleId && i.member.roles.cache.has(r)) : [];
  if (swapped.length) await i.member.roles.remove(swapped, 'DelyForge reaction roles (one role only)');
  await i.member.roles.add(roleId, 'DelyForge reaction roles');
  await ephemeral(i, `Added <@&${roleId}>.${swapped.length ? ` Removed ${swapped.map((r) => `<@&${r}>`).join(' ')}.` : ''}`);
}

/** A role menu: the selection becomes the member's roles from this panel. */
export async function onRoleMenu(ctx: ModuleContext, i: StringSelectMenuInteraction, panelId: string): Promise<void> {
  if (!i.inCachedGuild()) return;
  const config = ctx.config(i.guildId).reactionRoles;
  const panel = config.enabled ? config.panels.find((p) => p.id === panelId) : undefined;
  if (!panel) return void (await ephemeral(i, 'This role panel is no longer active.'));
  if (panel.requiredRoleId && !i.member.roles.cache.has(panel.requiredRoleId)) return void (await ephemeral(i, `You need <@&${panel.requiredRoleId}> to use this panel.`));
  const panelRoles = panel.roles.map((r) => r.roleId);
  const chosen = i.values.filter((v) => panelRoles.includes(v)); // ignore anything not on the panel
  const allowed = assignable(i.member, panelRoles);
  const add = chosen.filter((r) => allowed.includes(r) && !i.member.roles.cache.has(r));
  const remove = allowed.filter((r) => !chosen.includes(r) && i.member.roles.cache.has(r));
  if (add.length) await i.member.roles.add(add, 'DelyForge reaction roles');
  if (remove.length) await i.member.roles.remove(remove, 'DelyForge reaction roles');
  const parts = [add.length ? `Added ${add.map((r) => `<@&${r}>`).join(' ')}` : '', remove.length ? `Removed ${remove.map((r) => `<@&${r}>`).join(' ')}` : '']
    .filter(Boolean)
    .join(' · ');
  await ephemeral(i, parts || 'No changes.');
}

// ─── Verification ─────────────────────────────────────────────────────────────────────────────────────────────────

export type VerifyOutcome = 'verified' | 'tooNew' | 'failed' | 'wrongAnswer' | 'kicked';
const OUTCOME = {
  verified: { title: '✅ Member verified', color: COLORS.success },
  tooNew: { title: '⛔ Verification refused — account too new', color: COLORS.warn },
  failed: { title: '❌ Verification failed — the bot couldn’t give the role', color: COLORS.danger },
  wrongAnswer: { title: '❓ Wrong answer to the check question', color: COLORS.warn },
  kicked: { title: '👢 Removed — didn’t verify in time', color: COLORS.danger },
} as const;

/** The log entry for one verify attempt: who, how old the account is, when they joined, and what happened. */
export function verifyLogEmbed(m: { id: string; tag: string; createdTimestamp: number; joinedTimestamp: number | null; avatarUrl: string }, outcome: VerifyOutcome, now = Date.now()) {
  const ageDays = Math.floor((now - m.createdTimestamp) / 86_400_000);
  const t = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;
  return {
    title: OUTCOME[outcome].title,
    color: OUTCOME[outcome].color,
    thumbnail: { url: m.avatarUrl },
    fields: [
      { name: 'Member', value: `<@${m.id}> · ${m.tag}\nID: \`${m.id}\``, inline: false },
      { name: 'Account created', value: `${t(m.createdTimestamp)} (${ageDays} day${ageDays === 1 ? '' : 's'} old)${ageDays < 7 ? ' ⚠️ new account' : ''}`, inline: true },
      { name: 'Joined the server', value: m.joinedTimestamp ? t(m.joinedTimestamp) : 'unknown', inline: true },
    ],
    timestamp: new Date(now).toISOString(),
  };
}

async function logVerify(ctx: ModuleContext, member: GuildMember, outcome: VerifyOutcome): Promise<void> {
  const channel = await sendableChannel(ctx, member.guild, ctx.config(member.guild.id).verification.logChannelId, 'Verification log');
  const embed = verifyLogEmbed(
    { id: member.id, tag: member.user.tag, createdTimestamp: member.user.createdTimestamp, joinedTimestamp: member.joinedTimestamp, avatarUrl: member.user.displayAvatarURL({ size: 128 }) },
    outcome,
  );
  await channel?.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((e: Error) => ctx.log('warn', `Verification log: ${e.message}`));
}

/** Answers to the check question, per server and member, for 5 minutes. Kept here, never in the pop-up's ID. */
const pending = new Map<string, { answer: number; until: number }>();

/** Verify button: checks the account, then asks the question (if on) or verifies straight away. */
export async function onVerify(ctx: ModuleContext, i: ButtonInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const config = ctx.config(i.guildId).verification;
  if (!config.enabled || !config.roleId) return void (await ephemeral(i, 'Verification isn’t active right now.'));
  if (i.member.roles.cache.has(config.roleId)) return void (await ephemeral(i, 'You’re already verified. ✅'));
  const ageDays = (Date.now() - i.user.createdTimestamp) / 86_400_000;
  if (ageDays < config.minAccountAgeDays) {
    ctx.log('info', `Verification refused for ${i.user.tag}: account is ${Math.floor(ageDays)} day(s) old.`);
    await ephemeral(i, `Your Discord account must be at least ${config.minAccountAgeDays} day(s) old to verify here.`);
    return void (await logVerify(ctx, i.member, 'tooNew'));
  }
  if (config.challenge === 'math') {
    const a = randomInt(2, 10);
    const b = randomInt(2, 10);
    if (pending.size > 5000) pending.clear();
    pending.set(`${i.guildId}:${i.user.id}`, { answer: a + b, until: Date.now() + 5 * 60_000 });
    return void (await i.showModal({
      title: 'Quick check',
      custom_id: 'df:vq:answer',
      components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.TextInput, custom_id: 'answer', label: `What is ${a} + ${b}?`, style: TextInputStyle.Short, required: true, max_length: 3 }] }],
    }));
  }
  await completeVerify(ctx, i);
}

/** The answer to the check question. */
export async function onVerifyAnswer(ctx: ModuleContext, i: ModalSubmitInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const key = `${i.guildId}:${i.user.id}`;
  const expected = pending.get(key);
  pending.delete(key);
  if (!expected || expected.until < Date.now()) return void (await ephemeral(i, 'That took too long — press Verify to get a new question.'));
  if (Number(i.fields.getTextInputValue('answer').trim()) !== expected.answer) {
    await ephemeral(i, 'Not quite — press Verify to try again.');
    return void (await logVerify(ctx, i.member, 'wrongAnswer'));
  }
  await completeVerify(ctx, i);
}

async function completeVerify(ctx: ModuleContext, i: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>): Promise<void> {
  const config = ctx.config(i.guildId).verification;
  if (!config.enabled || !config.roleId) return void (await ephemeral(i, 'Verification isn’t active right now.'));
  if (!assignable(i.member, [config.roleId]).length) {
    ctx.log('warn', 'Verification: can’t give the verified role — move the bot’s role above it.');
    await ephemeral(i, 'I can’t verify you right now. Please tell a server admin.');
    return void (await logVerify(ctx, i.member, 'failed'));
  }
  const given = await i.member.roles.add(config.roleId, 'DelyForge verification').then(
    () => true,
    (e: Error) => (ctx.log('warn', `Verification: could not give the role to ${i.user.tag}: ${e.message}`), false),
  );
  if (!given) {
    await ephemeral(i, 'I can’t verify you right now. Please tell a server admin.');
    return void (await logVerify(ctx, i.member, 'failed'));
  }
  if (config.removeRoleId && i.member.roles.cache.has(config.removeRoleId) && assignable(i.member, [config.removeRoleId]).length) {
    await i.member.roles.remove(config.removeRoleId, 'DelyForge verification').catch(() => null);
  }
  await ephemeral(i, 'You’re verified — welcome! ✅');
  if (config.dmMessage.trim()) await tryDM(i.user, renderTemplate(config.dmMessage, templateVars(i.member)));
  await logVerify(ctx, i.member, 'verified');
}

/**
 * Members to remove for not verifying in time. Only members with no roles at all (besides the "unverified" role) —
 * so staff or anyone given a role by hand is never kicked.
 */
export function pickUnverified(
  members: readonly { id: string; bot: boolean; joinedAt: number | null; roleIds: readonly string[] }[],
  c: { roleId: string; removeRoleId: string | null; kickAfterHours: number },
  everyoneId: string,
  now: number,
): string[] {
  const cutoff = now - c.kickAfterHours * 3_600_000;
  return members
    .filter((m) => !m.bot && m.joinedAt !== null && m.joinedAt < cutoff && m.roleIds.every((r) => r === everyoneId || r === c.removeRoleId))
    .map((m) => m.id);
}

/** Every 10 minutes: removes members who didn't verify in time (at most 25 per check). */
export async function kickUnverified(ctx: ModuleContext, guild: Guild, now = Date.now()): Promise<void> {
  const c = ctx.config(guild.id).verification;
  if (!c.enabled || !c.roleId || !c.kickAfterHours) return;
  const members = await guild.members.fetch().catch(() => null);
  if (!members) return;
  const ids = pickUnverified(
    [...members.values()].map((m) => ({ id: m.id, bot: m.user.bot, joinedAt: m.joinedTimestamp, roleIds: [...m.roles.cache.keys()] })),
    { roleId: c.roleId, removeRoleId: c.removeRoleId, kickAfterHours: c.kickAfterHours },
    guild.id,
    now,
  ).slice(0, 25);
  for (const id of ids) {
    const m = members.get(id);
    if (!m?.kickable) continue;
    await tryDM(m.user, `You were removed from **${guild.name}** because you didn’t verify within ${c.kickAfterHours} hour(s). You’re welcome to join again.`);
    const kicked = await m.kick(`Didn’t verify within ${c.kickAfterHours} hour(s)`).then(
      () => true,
      () => false,
    );
    if (kicked) await logVerify(ctx, m, 'kicked');
  }
}
