import { randomInt } from 'node:crypto';
import { type ChatInputCommandInteraction, ChannelType, type Client, type Message, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { parseDuration } from './community.js';
import { BRAND_COLOR, type ModuleContext, truncate, tryDM } from './context.js';

export const UTILITY_COMMANDS = new Set(['serverinfo', 'userinfo', 'avatar', 'poll', 'remind', 'roll', 'afk', 'roleinfo', 'channelinfo', 'membercount', 'choose', 'emoji', 'timestamp', 'banner']);

/**
 * "<:name:123>" / "<a:name:123>" → the emoji's image on Discord's CDN; or an image link, but only one on Discord's own
 * CDN — the bot downloads it from this PC, so it must never be pointed at other addresses (e.g. the home network).
 */
export function emojiSource(input: string): { url: string; name: string | null } | null {
  const m = /<(a?):(\w{2,32}):(\d{17,20})>/.exec(input);
  if (m) return { url: `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'png'}`, name: m[2]! };
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const discordCdn = url.protocol === 'https:' && !url.port && !url.username && (url.hostname === 'cdn.discordapp.com' || url.hostname === 'media.discordapp.net');
  return discordCdn && /\.(png|jpe?g|gif|webp)$/i.test(url.pathname) ? { url: url.href, name: null } : null;
}

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
  const name = i.commandName as keyof NonNullable<typeof config>['commands'];
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
      if (!i.inCachedGuild() || !i.channel?.permissionsFor(i.member).has(PermissionFlagsBits.SendMessages)) {
        return void (await i.reply({ content: 'You can only set reminders in channels where you can post.', flags: MessageFlags.Ephemeral }));
      }
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
    case 'afk': {
      if (!i.guildId) return;
      const why = truncate(i.options.getString('reason') ?? 'AFK', 200);
      ctx.store.setAfk(i.guildId, i.user.id, why, Date.now());
      await i.reply({ content: `💤 You’re AFK: ${why}. It’s cleared when you send a message.`, allowedMentions: { parse: [] } });
      return;
    }
    case 'roleinfo': {
      const role = i.guild?.roles.cache.get(i.options.getRole('role', true).id);
      if (!role) return;
      await i.reply({
        embeds: [
          {
            title: `@${role.name}`,
            color: role.color || BRAND_COLOR,
            fields: [
              { name: 'Members', value: String(role.members.size), inline: true },
              { name: 'Colour', value: role.hexColor, inline: true },
              { name: 'Position', value: String(role.position), inline: true },
              { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
              { name: 'Shown separately', value: role.hoist ? 'Yes' : 'No', inline: true },
              { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:D>`, inline: true },
              { name: 'Key permissions', value: role.permissions.has(PermissionFlagsBits.Administrator) ? 'Administrator' : (['ManageGuild', 'ManageRoles', 'ManageChannels', 'BanMembers', 'KickMembers', 'ManageMessages', 'ModerateMembers'] as const).filter((p) => role.permissions.has(p)).join(', ') || 'None' },
            ],
            footer: { text: `ID ${role.id}` },
          },
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }
    case 'channelinfo': {
      const ch = i.guild?.channels.cache.get(i.options.getChannel('channel')?.id ?? i.channelId);
      if (!ch) return;
      await i.reply({
        embeds: [
          {
            title: `#${ch.name}`,
            color: BRAND_COLOR,
            fields: [
              { name: 'Type', value: ChannelType[ch.type].replace(/^Guild/, ''), inline: true },
              { name: 'Created', value: `<t:${Math.floor((ch.createdTimestamp ?? 0) / 1000)}:D>`, inline: true },
              ...('parent' in ch && ch.parent ? [{ name: 'Category', value: ch.parent.name, inline: true }] : []),
              ...('topic' in ch && ch.topic ? [{ name: 'Topic', value: truncate(ch.topic, 1000) }] : []),
              ...('rateLimitPerUser' in ch && ch.rateLimitPerUser ? [{ name: 'Slowmode', value: `${ch.rateLimitPerUser}s`, inline: true }] : []),
            ],
            footer: { text: `ID ${ch.id}` },
          },
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }
    case 'membercount': {
      const g = i.guild!;
      const bots = g.members.cache.filter((m) => m.user.bot).size;
      await i.reply({ embeds: [{ title: `👥 ${g.name}`, description: `**${g.memberCount}** members${bots ? ` · about **${g.memberCount - bots}** people and **${bots}** bots` : ''}`, color: BRAND_COLOR }] });
      return;
    }
    case 'choose': {
      const options = parsePollOptions(i.options.getString('options', true));
      if (!options) return void (await i.reply({ content: 'Give 2–10 different choices separated by |', flags: MessageFlags.Ephemeral }));
      await i.reply({ content: `🤔 I pick: **${options[randomInt(options.length)]}**`, allowedMentions: { parse: [] } });
      return;
    }
    case 'emoji': {
      const g = i.guild;
      if (!g || !i.inCachedGuild() || !i.member.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) return void (await i.reply({ content: 'You need the Manage Expressions permission.', flags: MessageFlags.Ephemeral }));
      const src = emojiSource(i.options.getString('emoji', true));
      const name = (i.options.getString('name') ?? src?.name ?? '').replace(/[^\w]/g, '_').slice(0, 32);
      if (!src || name.length < 2) return void (await i.reply({ content: 'Paste a server emoji (like <:wave:123…>) or a Discord image link (cdn.discordapp.com), and give it a name if it’s a link.', flags: MessageFlags.Ephemeral }));
      await i.deferReply();
      const made = await g.emojis.create({ attachment: src.url, name, reason: `Added by ${i.user.tag}` }).catch((e: Error) => e);
      if (made instanceof Error) {
        ctx.log('warn', `/emoji: could not add an emoji: ${made.message}`);
        return void (await i.editReply('I couldn’t add it — the server may be out of emoji slots, or the image is too big (max 256 KB).'));
      }
      await i.editReply(`Added ${made.toString()} as \`:${made.name}:\`.`);
      return;
    }
    case 'timestamp': {
      const ms = parseDuration(i.options.getString('in', true));
      if (!ms) return void (await i.reply({ content: 'Use a time like `2h`, `1d` or `1h30m`.', flags: MessageFlags.Ephemeral }));
      const t = Math.floor((Date.now() + ms) / 1000);
      await i.reply({ content: `<t:${t}:F> (<t:${t}:R>)\nCopy: \`<t:${t}:F>\` · \`<t:${t}:R>\``, flags: MessageFlags.Ephemeral });
      return;
    }
    case 'banner': {
      const user = await (i.options.getUser('user') ?? i.user).fetch(true).catch(() => null);
      const url = user?.bannerURL({ size: 1024 });
      if (!url) return void (await i.reply({ content: user?.hexAccentColor ? `They don’t have a banner — their profile colour is ${user.hexAccentColor}.` : 'They don’t have a banner.', flags: MessageFlags.Ephemeral }));
      await i.reply({ embeds: [{ title: `${user!.username}’s banner`, image: { url }, url, color: BRAND_COLOR }], allowedMentions: { parse: [] } });
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

// ─── AFK and the DISBOARD bump reminder ───────────────────────────────────────────────────────────────────────────

/** Clears the author's AFK, and tells people when they ping someone who is AFK (at most every 30 s per channel). */
const afkNoticeAt = new Map<string, number>();
export async function onAfkMessage(ctx: ModuleContext, m: Message): Promise<void> {
  if (!m.inGuild() || m.author.bot) return;
  const c = ctx.config(m.guild.id).utility;
  if (!c.enabled || !c.commands.afk) return;
  if (ctx.store.clearAfk(m.guild.id, m.author.id)) {
    const back = await m.reply({ content: `👋 Welcome back <@${m.author.id}> — I removed your AFK.`, allowedMentions: { parse: [] } }).catch(() => null);
    if (back) setTimeout(() => void back.delete().catch(() => null), 5000);
  }
  const away = [...m.mentions.users.values()].filter((u) => u.id !== m.author.id).map((u) => ({ u, afk: ctx.store.afk(m.guild.id, u.id) })).filter((x) => x.afk);
  if (!away.length || Date.now() - (afkNoticeAt.get(m.channelId) ?? 0) < 30_000) return;
  afkNoticeAt.set(m.channelId, Date.now());
  await m.reply({ content: away.map((x) => `💤 **${x.u.username}** is AFK: ${x.afk!.reason} (<t:${Math.floor(x.afk!.since / 1000)}:R>)`).join('\n'), allowedMentions: { parse: [] } }).catch(() => null);
}

const DISBOARD = '302050872383242240';
/** Servers with a bump reminder waiting (so a second bump doesn't start a second timer). */
const bumpTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** After a successful /bump with DISBOARD, remind the channel in 2 hours. */
export async function onBumpMessage(ctx: ModuleContext, m: Message): Promise<void> {
  if (!m.inGuild() || m.author.id !== DISBOARD) return;
  const c = ctx.config(m.guild.id).utility;
  if (!c.enabled || !c.bumpReminder.enabled) return;
  // DISBOARD's success card says "Bump done"; without message content we only see that it answered /bump.
  const text = m.embeds[0]?.description ?? '';
  const bumper = m.interactionMetadata?.user;
  if (!bumper || (text && !/bump done/i.test(text))) return;
  clearTimeout(bumpTimers.get(m.guild.id));
  const channel = m.channel;
  await m.react('⏰').catch(() => null);
  bumpTimers.set(
    m.guild.id,
    setTimeout(() => {
      bumpTimers.delete(m.guild.id);
      const role = ctx.config(m.guild.id).utility.bumpReminder.roleId;
      void channel
        .send({ content: `${role ? `<@&${role}> ` : ''}⏰ The server can be bumped again! Use \`/bump\`. (Last bump by <@${bumper.id}>)`, allowedMentions: { roles: role ? [role] : [] } })
        .catch(() => null);
    }, 2 * 3_600_000),
  );
}

/** Every 15 s: delivers due reminders in the channel they were set in (or by DM if that's not possible). */
export async function deliverReminders(ctx: ModuleContext, client: Client): Promise<void> {
  for (const r of ctx.store.takeDueReminders(Date.now())) {
    const text = `⏰ <@${r.userId}> here’s your reminder: ${r.text}`;
    const guild = client.guilds.cache.get(r.guildId);
    const channel = guild?.channels.cache.get(r.channelId);
    // Only post where the member could post themselves right now (still here, allowed to talk, not timed out);
    // otherwise the bot would carry their text into a read-only channel. Fall back to a DM.
    const member = guild ? await guild.members.fetch(r.userId).catch(() => null) : null;
    const mayPost =
      member && !member.isCommunicationDisabled() && channel?.isSendable() && channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
    const posted = mayPost ? await channel.send({ content: text, allowedMentions: { users: [r.userId] } }).then(() => true, () => false) : false;
    if (!posted) {
      const user = await client.users.fetch(r.userId).catch(() => null);
      if (user) await tryDM(user, `⏰ Reminder: ${r.text}`);
    }
  }
}
