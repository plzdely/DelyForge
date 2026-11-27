import type { ChatInputCommandInteraction, Guild, Message } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { COLORS, type ModuleContext, sendableChannel } from './context.js';

/** Activity stats: messages and voice minutes per member per day (UTC). */

export const ACTIVITY_COMMANDS = new Set(['activity', 'topchatters', 'topvoice', 'serveractivity']);

export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** The first day of a period: '1' = today, '7' / '30' = that many days including today, 'all' = ''. */
export function periodStart(period: string, now: number): string {
  return period === 'all' ? '' : dayOf(now - (Number(period) - 1) * 86_400_000);
}
const hours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

export function onActivityMessage(ctx: ModuleContext, m: Message): void {
  if (!m.inGuild() || m.author.bot) return;
  const c = ctx.config(m.guild.id).activity;
  if (!c.enabled) return;
  const channelId = m.channel.isThread() ? (m.channel.parentId ?? m.channelId) : m.channelId;
  if (c.ignoredChannelIds.includes(channelId)) return;
  ctx.store.addActivity(m.guild.id, m.author.id, dayOf(Date.now()), 1, 0);
}

/** Once a minute: a minute of voice for everyone in a voice channel (not alone, not deafened, not AFK). */
export function activityVoiceTick(ctx: ModuleContext, guild: Guild): void {
  const c = ctx.config(guild.id).activity;
  if (!c.enabled) return;
  const day = dayOf(Date.now());
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isVoiceBased() || channel.id === guild.afkChannelId || c.ignoredChannelIds.includes(channel.id)) continue;
    const people = channel.members.filter((m) => !m.user.bot);
    if (people.size < 2) continue;
    for (const m of people.values()) if (!m.voice.selfDeaf && !m.voice.serverDeaf) ctx.store.addActivity(guild.id, m.id, day, 0, 1);
  }
}

export async function handleActivityCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  if (!ctx.config(i.guildId).activity.enabled) return void (await i.reply({ content: 'Activity stats aren’t enabled here.', flags: MessageFlags.Ephemeral }));
  const now = Date.now();
  if (i.commandName === 'activity') {
    const user = i.options.getUser('member') ?? i.user;
    const row = (p: string) => ctx.store.activityOf(i.guildId, user.id, periodStart(p, now));
    const [d, w, mo, all] = [row('1'), row('7'), row('30'), row('all')];
    return void (await i.reply({
      embeds: [
        {
          author: { name: user.username, icon_url: user.displayAvatarURL({ size: 64 }) },
          color: COLORS.brand,
          fields: [
            { name: 'Today', value: `💬 ${d.messages}\n🎙️ ${hours(d.voice)}`, inline: true },
            { name: '7 days', value: `💬 ${w.messages}\n🎙️ ${hours(w.voice)}`, inline: true },
            { name: '30 days', value: `💬 ${mo.messages}\n🎙️ ${hours(mo.voice)}`, inline: true },
            { name: 'All time', value: `💬 ${all.messages} messages · 🎙️ ${hours(all.voice)} in voice` },
          ],
        },
      ],
      allowedMentions: { parse: [] },
    }));
  }
  if (i.commandName === 'serveractivity') {
    const days = ctx.store.serverActivity(i.guildId, periodStart('7', now));
    const max = Math.max(1, ...days.map((x) => x.messages));
    const lines = days.map((x) => `\`${x.day.slice(5)}\` ${'█'.repeat(Math.max(1, Math.round((x.messages / max) * 15)))} ${x.messages} msgs · ${hours(x.voice)} · ${x.members} active`);
    return void (await i.reply({ embeds: [{ title: '📈 Last 7 days', description: lines.join('\n') || 'No activity recorded yet.', color: COLORS.brand }] }));
  }
  const by = i.commandName === 'topvoice' ? 'voice' : 'messages';
  const period = i.options.getString('period') ?? '7';
  const top = ctx.store.topActivity(i.guildId, periodStart(period, now), by, 10);
  const label = { '1': 'today', '7': 'in the last 7 days', '30': 'in the last 30 days', all: 'of all time' }[period] ?? '';
  await i.reply({
    embeds: [{ title: by === 'voice' ? `🎙️ Most time in voice ${label}` : `💬 Top chatters ${label}`, description: top.map((t, n) => `**${n + 1}.** <@${t.userId}> — ${by === 'voice' ? hours(t.n) : `${t.n} messages`}`).join('\n') || 'Nothing yet.', color: COLORS.brand }],
    allowedMentions: { parse: [] },
  });
}

/** The weekly summary, once on the chosen day and hour (UTC). */
export async function weeklyActivityReport(ctx: ModuleContext, guild: Guild, now = Date.now()): Promise<void> {
  const c = ctx.config(guild.id).activity;
  const d = new Date(now);
  if (!c.enabled || !c.report.channelId || d.getUTCDay() !== c.report.day || d.getUTCHours() !== c.report.hourUtc) return;
  if (ctx.store.bumpShopCount(guild.id, `activity-report:${dayOf(now)}`) !== 1) return;
  const channel = await sendableChannel(ctx, guild, c.report.channelId, 'Weekly activity report');
  if (!channel) return;
  const from = periodStart('7', now);
  const chat = ctx.store.topActivity(guild.id, from, 'messages', 5);
  const voice = ctx.store.topActivity(guild.id, from, 'voice', 5);
  const total = ctx.store.serverActivity(guild.id, from).reduce((a, x) => ({ m: a.m + x.messages, v: a.v + x.voice }), { m: 0, v: 0 });
  await channel
    .send({
      embeds: [
        {
          title: '📊 This week in the server',
          description: `**${total.m}** messages and **${hours(total.v)}** in voice.`,
          fields: [
            { name: '💬 Top chatters', value: chat.map((t, n) => `${n + 1}. <@${t.userId}> — ${t.n}`).join('\n') || '—', inline: true },
            { name: '🎙️ Most in voice', value: voice.map((t, n) => `${n + 1}. <@${t.userId}> — ${hours(t.n)}`).join('\n') || '—', inline: true },
          ],
          color: COLORS.brand,
        },
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => null);
}
