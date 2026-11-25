import { renderTemplate } from '@delyforge/shared';
import { ButtonStyle, ComponentType, type GuildMember, type PartialGuildMember } from 'discord.js';
import { type ModuleContext, SAFE_MENTIONS, hexToInt, sendableChannel, templateVars, tryDM } from './context.js';
import { assignable } from './roles.js';

export async function onMemberJoin(ctx: ModuleContext, member: GuildMember): Promise<void> {
  const config = ctx.config(member.guild.id).welcome;
  if (!config.enabled) return;

  // Automatic roles: bots get the bot roles, people the member roles — optionally after a delay.
  const roleIds = member.user.bot ? config.autoRoles.botRoleIds : config.autoRoles.roleIds;
  if (roleIds.length) {
    const give = async () => {
      // After a delay the member may have left, so look them up again.
      const m = config.autoRoles.delayMinutes ? await member.guild.members.fetch(member.id).catch(() => null) : member;
      if (!m) return;
      const allowed = assignable(m, roleIds);
      if (allowed.length < roleIds.length) {
        ctx.log('warn', `Welcome: ${roleIds.length - allowed.length} auto-role(s) can’t be given — move DelyForge’s bot role above them in Server Settings → Roles.`);
      }
      if (allowed.length) await m.roles.add(allowed, 'DelyForge welcome auto-roles').catch((e: Error) => ctx.log('warn', `Welcome: could not add roles: ${e.message}`));
    };
    // shortcut: a delayed role is lost if the bot restarts during the wait; fine for delays of up to an hour.
    if (config.autoRoles.delayMinutes) setTimeout(() => void give(), config.autoRoles.delayMinutes * 60_000);
    else await give();
  }
  if (member.user.bot) return;

  await sendWelcome(ctx, member);

  // A quick ping in chosen channels (e.g. #rules) so new members notice them; the ping is removed right away.
  for (const channelId of config.pingChannelIds) {
    const channel = await sendableChannel(ctx, member.guild, channelId, 'Welcome ping');
    const ping = await channel?.send({ content: `<@${member.id}>`, allowedMentions: { users: [member.id] } }).catch(() => null);
    if (ping) setTimeout(() => void ping.delete().catch(() => null), 3_000);
  }
}

/** The welcome message and DM (no roles). Also used by the "Send a test" button. */
export async function sendWelcome(ctx: ModuleContext, member: GuildMember): Promise<{ posted: boolean; dm: boolean }> {
  const config = ctx.config(member.guild.id).welcome;
  const vars = templateVars(member);
  let posted = false;
  let dm = false;
  if (config.welcome.enabled) {
    const channel = await sendableChannel(ctx, member.guild, config.welcome.channelId, 'Welcome message');
    if (channel) {
      const text = renderTemplate(config.welcome.message, vars);
      const style = config.welcome.style;
      const buttons = config.welcome.buttons.length
        ? [{ type: ComponentType.ActionRow as const, components: config.welcome.buttons.map((b) => ({ type: ComponentType.Button as const, style: ButtonStyle.Link as const, label: b.label, url: b.url })) }]
        : [];
      await channel
        .send(
          style.embed
            ? {
                content: `<@${member.id}>`,
                embeds: [
                  {
                    title: style.title ? renderTemplate(style.title, vars) : undefined,
                    description: text,
                    color: hexToInt(style.color),
                    thumbnail: { url: member.user.displayAvatarURL({ size: 256 }) },
                    image: style.imageUrl ? { url: style.imageUrl } : undefined,
                  },
                ],
                components: buttons,
                allowedMentions: SAFE_MENTIONS,
              }
            : { content: text, components: buttons, allowedMentions: SAFE_MENTIONS },
        )
        .then(
          () => (posted = true),
          (e: Error) => ctx.log('warn', `Welcome: could not send message: ${e.message}`),
        );
    }
  }

  if (config.dm.enabled && config.dm.message.trim()) {
    dm = await tryDM(member.user, renderTemplate(config.dm.message, vars));
    if (!dm) ctx.log('info', `Welcome: ${member.user.tag} doesn’t accept DMs.`);
  }
  return { posted, dm };
}

export async function onMemberLeave(ctx: ModuleContext, member: GuildMember | PartialGuildMember): Promise<void> {
  const config = ctx.config(member.guild.id).welcome;
  if (!config.enabled || !config.goodbye.enabled || member.user?.bot) return;
  await sendGoodbye(ctx, member);
}

/** The goodbye message. Also used by the "Send a test" button. */
export async function sendGoodbye(ctx: ModuleContext, member: GuildMember | PartialGuildMember): Promise<boolean> {
  const config = ctx.config(member.guild.id).welcome;
  const channel = await sendableChannel(ctx, member.guild, config.goodbye.channelId, 'Goodbye message');
  if (!channel || !member.user) return false;
  const text = renderTemplate(config.goodbye.message, {
    user: `<@${member.user.id}>`,
    'user.name': member.displayName ?? member.user.username,
    'user.id': member.user.id,
    server: member.guild.name,
    memberCount: member.guild.memberCount,
  });
  const payload = config.goodbye.embed
    ? { embeds: [{ description: text, color: hexToInt(config.goodbye.color), thumbnail: { url: member.user.displayAvatarURL({ size: 128 }) } }], allowedMentions: { parse: [] as [] } }
    : { content: text, allowedMentions: { parse: [] as [] } };
  return channel.send(payload).then(
    () => true,
    (e: Error) => (ctx.log('warn', `Goodbye: could not send message: ${e.message}`), false),
  );
}
