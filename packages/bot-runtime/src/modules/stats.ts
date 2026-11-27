import { renderTemplate } from '@delyforge/shared';
import type { Guild } from 'discord.js';
import type { ModuleContext } from './context.js';

export interface ServerCounts {
  members: number;
  humans: number;
  bots: number;
  boosts: number;
  channels: number;
  roles: number;
  textChannels: number;
  voiceChannels: number;
  emojis: number;
  boostTier: number;
}

/** A counter channel's name (Discord allows up to 100 characters). */
export function statName(template: string, counts: ServerCounts): string {
  return renderTemplate(template, { ...counts }).slice(0, 100);
}

/** Renames the counter channels. Discord allows 2 renames per channel every 10 minutes, so this runs on a timer. */
export async function updateStats(ctx: ModuleContext, guild: Guild): Promise<void> {
  const config = ctx.config(guild.id).serverStats;
  if (!config.enabled || !config.counters.length) return;
  if (config.counters.some((c) => /\{(humans|bots)\}/.test(c.template))) await guild.members.fetch().catch(() => null);
  const bots = guild.members.cache.filter((m) => m.user.bot).size;
  const counts: ServerCounts = {
    members: guild.memberCount,
    humans: Math.max(0, guild.memberCount - bots),
    bots,
    boosts: guild.premiumSubscriptionCount ?? 0,
    channels: guild.channels.cache.size,
    roles: Math.max(0, guild.roles.cache.size - 1), // without @everyone
    textChannels: guild.channels.cache.filter((c) => c.isTextBased() && !c.isThread() && !c.isVoiceBased()).size,
    voiceChannels: guild.channels.cache.filter((c) => c.isVoiceBased()).size,
    emojis: guild.emojis.cache.size,
    boostTier: guild.premiumTier,
  };
  for (const counter of config.counters) {
    const channel = guild.channels.cache.get(counter.channelId);
    if (!channel) {
      ctx.log('warn', `Server stats: a counter channel no longer exists in “${guild.name}”.`);
      continue;
    }
    const name = statName(counter.template, counts);
    if (channel.name !== name) await channel.setName(name, 'Server stats counter').catch((e: Error) => ctx.log('warn', `Server stats: could not rename #${channel.name}: ${e.message}`));
  }
}
