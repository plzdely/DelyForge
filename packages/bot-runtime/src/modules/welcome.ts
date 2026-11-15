import { renderTemplate } from '@delyforge/shared';
import type { GuildMember, PartialGuildMember } from 'discord.js';
import { type ModuleContext, SAFE_MENTIONS, hexToInt, sendableChannel, templateVars, tryDM } from './context.js';

export async function onMemberJoin(ctx: ModuleContext, member: GuildMember): Promise<void> {
  const config = ctx.config(member.guild.id).welcome;
  if (!config.enabled || member.user.bot) return;
  const vars = templateVars(member);

  // Automatic roles — only roles the bot is allowed to give (below its own highest role, not managed).
  if (config.autoRoles.roleIds.length) {
    const me = member.guild.members.me;
    const assignable = config.autoRoles.roleIds.filter((id) => {
      const role = member.guild.roles.cache.get(id);
      return role && !role.managed && me && role.position < me.roles.highest.position;
    });
    const skipped = config.autoRoles.roleIds.length - assignable.length;
    if (skipped) {
      ctx.log('warn', `Welcome: ${skipped} auto-role(s) can’t be given — move DelyForge’s bot role above them in Server Settings → Roles.`);
    }
    if (assignable.length) {
      await member.roles.add(assignable, 'DelyForge welcome auto-roles').catch((e: Error) => ctx.log('warn', `Welcome: could not add roles: ${e.message}`));
    }
  }

  if (config.welcome.enabled) {
    const channel = await sendableChannel(ctx, member.guild, config.welcome.channelId, 'Welcome message');
    if (channel) {
      const text = renderTemplate(config.welcome.message, vars);
      const style = config.welcome.style;
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
                  },
                ],
                allowedMentions: SAFE_MENTIONS,
              }
            : { content: text, allowedMentions: SAFE_MENTIONS },
        )
        .catch((e: Error) => ctx.log('warn', `Welcome: could not send message: ${e.message}`));
    }
  }

  if (config.dm.enabled && config.dm.message.trim()) {
    const sent = await tryDM(member.user, renderTemplate(config.dm.message, vars));
    if (!sent) ctx.log('info', `Welcome: ${member.user.tag} doesn’t accept DMs.`);
  }
}

export async function onMemberLeave(ctx: ModuleContext, member: GuildMember | PartialGuildMember): Promise<void> {
  const config = ctx.config(member.guild.id).welcome;
  if (!config.enabled || !config.goodbye.enabled || member.user?.bot) return;
  const channel = await sendableChannel(ctx, member.guild, config.goodbye.channelId, 'Goodbye message');
  if (!channel || !member.user) return;
  const text = renderTemplate(config.goodbye.message, {
    user: `<@${member.user.id}>`,
    'user.name': member.displayName ?? member.user.username,
    'user.id': member.user.id,
    server: member.guild.name,
    memberCount: member.guild.memberCount,
  });
  await channel.send({ content: text, allowedMentions: { parse: [] } }).catch((e: Error) => ctx.log('warn', `Goodbye: could not send message: ${e.message}`));
}
