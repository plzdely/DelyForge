import { type ButtonInteraction, type GuildMember, MessageFlags, PermissionFlagsBits, type StringSelectMenuInteraction } from 'discord.js';
import { COLORS, type ModuleContext, sendableChannel } from './context.js';

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

const ephemeral = (i: ButtonInteraction | StringSelectMenuInteraction, content: string) =>
  i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

// ─── Reaction roles ───────────────────────────────────────────────────────────────────────────────────────────────

/** A role button: toggles that role. The role must still be on the panel in the current settings. */
export async function onRoleButton(ctx: ModuleContext, i: ButtonInteraction, panelId: string, roleId: string): Promise<void> {
  if (!i.inCachedGuild()) return;
  const config = ctx.config(i.guildId).reactionRoles;
  const panel = config.enabled ? config.panels.find((p) => p.id === panelId) : undefined;
  if (!panel?.roles.some((r) => r.roleId === roleId)) return void (await ephemeral(i, 'This role panel is no longer active.'));
  if (!assignable(i.member, [roleId]).length) {
    ctx.log('warn', `Reaction roles: can’t give <@&${roleId}> — move the bot’s role above it.`);
    return void (await ephemeral(i, 'I can’t give that role right now. Please tell a server admin.'));
  }
  if (i.member.roles.cache.has(roleId)) {
    await i.member.roles.remove(roleId, 'DelyForge reaction roles');
    await ephemeral(i, `Removed <@&${roleId}>.`);
  } else {
    await i.member.roles.add(roleId, 'DelyForge reaction roles');
    await ephemeral(i, `Added <@&${roleId}>.`);
  }
}

/** A role menu: the selection becomes the member's roles from this panel. */
export async function onRoleMenu(ctx: ModuleContext, i: StringSelectMenuInteraction, panelId: string): Promise<void> {
  if (!i.inCachedGuild()) return;
  const config = ctx.config(i.guildId).reactionRoles;
  const panel = config.enabled ? config.panels.find((p) => p.id === panelId) : undefined;
  if (!panel) return void (await ephemeral(i, 'This role panel is no longer active.'));
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

export type VerifyOutcome = 'verified' | 'tooNew' | 'failed';
const OUTCOME = {
  verified: { title: '✅ Member verified', color: COLORS.success },
  tooNew: { title: '⛔ Verification refused — account too new', color: COLORS.warn },
  failed: { title: '❌ Verification failed — the bot couldn’t give the role', color: COLORS.danger },
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

export async function onVerify(ctx: ModuleContext, i: ButtonInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const config = ctx.config(i.guildId).verification;
  if (!config.enabled || !config.roleId) return void (await ephemeral(i, 'Verification isn’t active right now.'));
  if (i.member.roles.cache.has(config.roleId)) return void (await ephemeral(i, 'You’re already verified. ✅'));
  const log = async (outcome: VerifyOutcome) => {
    const channel = await sendableChannel(ctx, i.guild, config.logChannelId, 'Verification log');
    const embed = verifyLogEmbed({ id: i.user.id, tag: i.user.tag, createdTimestamp: i.user.createdTimestamp, joinedTimestamp: i.member.joinedTimestamp, avatarUrl: i.user.displayAvatarURL({ size: 128 }) }, outcome);
    await channel?.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((e: Error) => ctx.log('warn', `Verification log: ${e.message}`));
  };
  const ageDays = (Date.now() - i.user.createdTimestamp) / 86_400_000;
  if (ageDays < config.minAccountAgeDays) {
    ctx.log('info', `Verification refused for ${i.user.tag}: account is ${Math.floor(ageDays)} day(s) old.`);
    await ephemeral(i, `Your Discord account must be at least ${config.minAccountAgeDays} day(s) old to verify here.`);
    return void (await log('tooNew'));
  }
  if (!assignable(i.member, [config.roleId]).length) {
    ctx.log('warn', 'Verification: can’t give the verified role — move the bot’s role above it.');
    await ephemeral(i, 'I can’t verify you right now. Please tell a server admin.');
    return void (await log('failed'));
  }
  await i.member.roles.add(config.roleId, 'DelyForge verification');
  if (config.removeRoleId && i.member.roles.cache.has(config.removeRoleId) && assignable(i.member, [config.removeRoleId]).length) {
    await i.member.roles.remove(config.removeRoleId, 'DelyForge verification');
  }
  await ephemeral(i, 'You’re verified — welcome! ✅');
  await log('verified');
}
