import { randomInt } from 'node:crypto';
import { type ChatInputCommandInteraction, ChannelType, type Client, MessageFlags } from 'discord.js';
import { parseDuration } from './community.js';
import { BRAND_COLOR, type ModuleContext, truncate, tryDM } from './context.js';

export const UTILITY_COMMANDS = new Set(['serverinfo', 'userinfo', 'avatar', 'poll', 'remind', 'roll']);

/** Splits "Yes | No | Maybe" into 2–10 trimmed, unique answers (Discord's poll limits). */
export function parsePollOptions(raw: string): string[] | null {
  const seen = new Set<string>();
  const answers = raw
    .split('|')
    .map((s) => s.trim().slice(0, 55))
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
  return answers.length >= 2 && answers.length <= 10 ? answers : null;
}

export async function handleUtilityCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  const config = i.guild ? ctx.config(i.guild.id).utility : null;
  const name = i.commandName as 'serverinfo' | 'userinfo' | 'avatar' | 'poll' | 'remind' | 'roll';
  if (config && (!config.enabled || !config.commands[name])) {
    await i.reply({ content: 'This command is turned off in this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  switch (name) {
    case 'serverinfo': {
      const g = i.guild!;
      const text = g.channels.cache.filter((c) => c.type === ChannelType.GuildText).size;
      const voice = g.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).size;
      await i.reply({
        embeds: [
          {
            title: g.name,
            thumbnail: g.iconURL() ? { url: g.iconURL({ size: 256 })! } : undefined,
            color: BRAND_COLOR,
            fields: [
              { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
              { name: 'Members', value: String(g.memberCount), inline: true },
              { name: 'Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
              { name: 'Channels', value: `${text} text · ${voice} voice`, inline: true },
              { name: 'Roles', value: String(g.roles.cache.size - 1), inline: true },
              { name: 'Boosts', value: `${g.premiumSubscriptionCount ?? 0} (tier ${g.premiumTier})`, inline: true },
            ],
          },
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }
    case 'userinfo': {
      const user = i.options.getUser('member') ?? i.user;
      const member = await i.guild!.members.fetch(user.id).catch(() => null);
      const roles = member ? member.roles.cache.filter((r) => r.id !== i.guild!.id).sort((a, b) => b.position - a.position) : null;
      await i.reply({
        embeds: [
          {
            title: member?.displayName ?? user.username,
            description: `<@${user.id}> · ${user.tag}${user.bot ? ' · 🤖 bot' : ''}`,
            thumbnail: { url: user.displayAvatarURL({ size: 256 }) },
            color: member?.displayColor || BRAND_COLOR,
            fields: [
              { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
              ...(member?.joinedTimestamp ? [{ name: 'Joined server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true }] : []),
              ...(roles?.size ? [{ name: `Roles (${roles.size})`, value: roles.map((r) => `<@&${r.id}>`).slice(0, 20).join(' ') }] : []),
            ],
          },
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }
    case 'avatar': {
      const user = i.options.getUser('user') ?? i.user;
      const url = user.displayAvatarURL({ size: 1024 });
      await i.reply({ embeds: [{ title: `${user.username}’s avatar`, image: { url }, url, color: BRAND_COLOR }], allowedMentions: { parse: [] } });
      return;
    }
    case 'remind': {
      if (!i.guildId || !i.channelId) return;
      const ms = parseDuration(i.options.getString('in', true));
      if (!ms) return void (await i.reply({ content: 'Use a time like `10m`, `2h`, `1d` or `1h30m` (1 minute to 30 days).', flags: MessageFlags.Ephemeral }));
      if (ctx.store.pendingReminders(i.guildId, i.user.id) >= 25) return void (await i.reply({ content: 'You already have 25 reminders waiting here.', flags: MessageFlags.Ephemeral }));
      const dueAt = Date.now() + ms;
      ctx.store.addReminder({ guildId: i.guildId, channelId: i.channelId, userId: i.user.id, text: truncate(i.options.getString('text', true), 500), dueAt });
      await i.reply({ content: `⏰ I’ll remind you <t:${Math.floor(dueAt / 1000)}:R>.`, flags: MessageFlags.Ephemeral });
      return;
    }
    case 'roll': {
      const sides = i.options.getInteger('sides') ?? 6;
      const dice = i.options.getInteger('dice') ?? 1;
      const rolls = Array.from({ length: dice }, () => randomInt(1, sides + 1));
      const total = rolls.reduce((a, b) => a + b, 0);
      await i.reply({ content: `🎲 ${dice}d${sides}: ${rolls.map((r) => `**${r}**`).join(' + ')}${dice > 1 ? ` = **${total}**` : ''}`, allowedMentions: { parse: [] } });
      return;
    }
    case 'poll': {
      const answers = parsePollOptions(i.options.getString('options', true));
      if (!answers) {
        await i.reply({ content: 'Give between 2 and 10 different answers, separated by | (e.g. `Yes | No | Maybe`).', flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        poll: {
          question: { text: i.options.getString('question', true).slice(0, 300) },
          answers: answers.map((text) => ({ text })),
          duration: i.options.getInteger('hours') ?? 24,
          allowMultiselect: i.options.getBoolean('multiple') ?? false,
        },
      });
      return;
    }
  }
}

/** Every 15 s: delivers due reminders in the channel they were set in (or by DM if that's not possible). */
export async function deliverReminders(ctx: ModuleContext, client: Client): Promise<void> {
  for (const r of ctx.store.takeDueReminders(Date.now())) {
    const text = `⏰ <@${r.userId}> here’s your reminder: ${r.text}`;
    const channel = client.guilds.cache.get(r.guildId)?.channels.cache.get(r.channelId);
    const posted = channel?.isSendable() ? await channel.send({ content: text, allowedMentions: { users: [r.userId] } }).then(() => true, () => false) : false;
    if (!posted) {
      const user = await client.users.fetch(r.userId).catch(() => null);
      if (user) await tryDM(user, `⏰ Reminder: ${r.text}`);
    }
  }
}
