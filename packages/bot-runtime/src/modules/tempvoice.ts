import { renderTemplate } from '@delyforge/shared';
import { ChannelType, type ChatInputCommandInteraction, type Guild, MessageFlags, type VoiceState } from 'discord.js';
import type { ModuleContext } from './context.js';

/** The new channel's name for a member (Discord allows up to 100 characters). */
export function tempChannelName(template: string, displayName: string): string {
  return renderTemplate(template, { user: displayName, 'user.name': displayName }).slice(0, 100) || 'Voice';
}

/** Deletes a temporary channel once nobody is left in it. */
async function removeIfEmpty(ctx: ModuleContext, guild: Guild, channelId: string): Promise<void> {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    ctx.store.removeTempChannel(channelId);
    return;
  }
  if (!channel.isVoiceBased() || channel.members.size > 0) return;
  await channel
    .delete('Temporary voice channel is empty')
    .then(() => ctx.store.removeTempChannel(channelId))
    .catch((e: Error) => ctx.log('warn', `Temporary voice: could not delete #${channel.name}: ${e.message}`));
}

export async function onVoiceState(ctx: ModuleContext, before: VoiceState, after: VoiceState): Promise<void> {
  const guild = after.guild;
  // Clean-up runs even if the module was switched off, so no empty channels are left behind.
  if (before.channelId && before.channelId !== after.channelId && ctx.store.isTempChannel(before.channelId)) {
    await removeIfEmpty(ctx, guild, before.channelId);
  }
  const config = ctx.config(guild.id).tempVoice;
  if (!config.enabled || !after.channelId || before.channelId === after.channelId) return;
  // Which "join to create" channel they joined: the main one, or one of the extra ones with its own name and limit.
  const hub =
    after.channelId === config.hubChannelId
      ? { nameTemplate: config.nameTemplate, userLimit: config.userLimit }
      : config.extraHubs.find((h) => h.hubChannelId === after.channelId);
  if (!hub) return;
  const member = after.member;
  if (!member || member.user.bot) return;
  const own = ctx.store.tempChannelOf(guild.id, member.id);
  const existing = own ? guild.channels.cache.get(own) : undefined;
  if (existing?.isVoiceBased()) {
    await member.voice.setChannel(existing).catch(() => null);
    return;
  }

  const parent = config.categoryId ?? after.channel?.parentId ?? null;
  // Created inside the category without explicit permissions, so it keeps the category's (e.g. private) settings.
  const created = await guild.channels
    .create({
      name: tempChannelName(hub.nameTemplate, member.displayName),
      type: ChannelType.GuildVoice,
      parent,
      ...(hub.userLimit ? { userLimit: hub.userLimit } : {}),
      reason: `Temporary voice channel for ${member.user.tag}`,
    })
    .catch((e: Error) => {
      ctx.log('warn', `Temporary voice: could not create a channel in “${guild.name}”: ${e.message}`);
      return null;
    });
  if (!created) return;
  ctx.store.addTempChannel(guild.id, created.id, member.id);
  // The owner can rename it, set a limit, and move or disconnect people in their own channel.
  await created.permissionOverwrites.edit(member.id, { ViewChannel: true, Connect: true, MoveMembers: true, ManageChannels: true }).catch(() => null);
  await member.voice.setChannel(created).catch(async () => {
    // They left before we could move them.
    await removeIfEmpty(ctx, guild, created.id);
  });
}

/** After a restart: removes temporary channels that emptied while the bot was offline. */
export async function cleanupTempChannels(ctx: ModuleContext, guild: Guild): Promise<void> {
  for (const id of ctx.store.tempChannels(guild.id)) await removeIfEmpty(ctx, guild, id);
}

/** /voice lock | unlock | limit | rename | claim — only for the owner of the temporary channel they're in. */
export async function handleVoiceCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const say = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  const config = ctx.config(i.guildId).tempVoice;
  if (!config.enabled || !config.ownerCommands) return void (await say('Temporary voice channels aren’t enabled here.'));
  const channel = i.member.voice.channel;
  if (!channel || !ctx.store.isTempChannel(channel.id)) return void (await say('Join your temporary voice channel first.'));
  const owner = ctx.store.tempChannelOwner(channel.id);
  const sub = i.options.getSubcommand();

  if (sub === 'claim') {
    if (owner === i.user.id) return void (await say('This channel is already yours.'));
    if (owner && channel.members.has(owner)) return void (await say(`<@${owner}> is still here — only an empty owner seat can be claimed.`));
    ctx.store.setTempChannelOwner(channel.id, i.user.id);
    await channel.permissionOverwrites.edit(i.user.id, { ViewChannel: true, Connect: true, MoveMembers: true, ManageChannels: true }).catch(() => null);
    return void (await say('🎙️ The channel is yours now.'));
  }
  if (owner !== i.user.id) return void (await say('Only the channel’s owner can do that. If they left, use /voice claim.'));

  const ok = (p: Promise<unknown>) => p.then(() => true, () => false);
  if (sub === 'lock' || sub === 'unlock') {
    const locking = sub === 'lock';
    // Locking keeps everyone who's already inside able to come back.
    const done = await ok(
      Promise.all([
        channel.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: locking ? false : null }),
        ...(locking ? [...channel.members.values()].map((m) => channel.permissionOverwrites.edit(m.id, { Connect: true })) : []),
      ]),
    );
    return void (await say(done ? (locking ? '🔒 Locked — nobody new can join.' : '🔓 Unlocked.') : 'I couldn’t change the channel (I need Manage Permissions).'));
  }
  if (sub === 'hide' || sub === 'unhide') {
    const hiding = sub === 'hide';
    const done = await ok(
      Promise.all([
        channel.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: hiding ? false : null }),
        ...(hiding ? [...channel.members.values()].map((m) => channel.permissionOverwrites.edit(m.id, { ViewChannel: true, Connect: true })) : []),
      ]),
    );
    return void (await say(done ? (hiding ? '🙈 Hidden — only people inside (and those you /voice permit) can see it.' : '👀 Visible again.') : 'I couldn’t change the channel (I need Manage Permissions).'));
  }
  if (sub === 'permit' || sub === 'kick' || sub === 'ban' || sub === 'transfer') {
    const target = await i.guild.members.fetch(i.options.getUser('member', true).id).catch(() => null);
    if (!target || target.user.bot) return void (await say('Pick a member of this server.'));
    if (target.id === i.user.id) return void (await say('Pick someone else.'));
    if (sub === 'permit') {
      const done = await ok(channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true }));
      return void (await say(done ? `✅ <@${target.id}> can join.` : 'I couldn’t change the channel.'));
    }
    if (sub === 'transfer') {
      if (target.voice.channelId !== channel.id) return void (await say('They need to be in your channel.'));
      ctx.store.setTempChannelOwner(channel.id, target.id);
      await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true, MoveMembers: true, ManageChannels: true }).catch(() => null);
      await channel.permissionOverwrites.edit(i.user.id, { MoveMembers: null, ManageChannels: null }).catch(() => null);
      return void (await say(`🎙️ <@${target.id}> owns the channel now.`));
    }
    if (target.permissions.has('MoveMembers')) return void (await say('You can’t remove staff from your channel.'));
    if (sub === 'ban') await channel.permissionOverwrites.edit(target.id, { Connect: false }).catch(() => null);
    if (target.voice.channelId === channel.id) await target.voice.disconnect(sub === 'ban' ? 'Banned from the channel by its owner' : 'Kicked from the channel by its owner').catch(() => null);
    return void (await say(sub === 'ban' ? `⛔ <@${target.id}> can’t join your channel any more.` : `👢 Disconnected <@${target.id}>.`));
  }
  if (sub === 'limit') {
    const people = i.options.getInteger('people', true);
    const done = await ok(channel.setUserLimit(people));
    return void (await say(done ? (people ? `Limit set to ${people}.` : 'No limit.') : 'I couldn’t change the limit.'));
  }
  const name = i.options.getString('name', true).trim().slice(0, 90) || 'Voice';
  const done = await ok(channel.setName(name));
  await say(done ? `Renamed to **${name}**.` : 'Couldn’t rename — Discord allows 2 renames every 10 minutes. Try again later.');
}
