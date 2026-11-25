import { renderTemplate } from '@delyforge/shared';
import { ChannelType, type Guild, type VoiceState } from 'discord.js';
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
  if (!config.enabled || !config.hubChannelId || after.channelId !== config.hubChannelId || before.channelId === after.channelId) return;
  const member = after.member;
  if (!member || member.user.bot) return;

  const parent = config.categoryId ?? after.channel?.parentId ?? null;
  // Created inside the category without explicit permissions, so it keeps the category's (e.g. private) settings.
  const created = await guild.channels
    .create({
      name: tempChannelName(config.nameTemplate, member.displayName),
      type: ChannelType.GuildVoice,
      parent,
      ...(config.userLimit ? { userLimit: config.userLimit } : {}),
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
