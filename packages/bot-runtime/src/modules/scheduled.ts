import type { ScheduledConfig } from '@delyforge/shared';
import type { Guild } from 'discord.js';
import { type ModuleContext, sendableChannel } from './context.js';

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The weekday (0 = Sunday), "HH:MM" and date in a time zone (summer/winter time included). Null for an unknown zone. */
export function localParts(now: Date, timeZone: string): { day: number; time: string; date: string } | null {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(now)
        .map((p) => [p.type, p.value]),
    );
    return { day: WEEKDAYS[parts['weekday']!] ?? 0, time: `${parts['hour']}:${parts['minute']}`, date: `${parts['year']}-${parts['month']}-${parts['day']}` };
  } catch {
    return null;
  }
}

/** Which scheduled messages are due at this moment. */
export function dueMessages(messages: ScheduledConfig['messages'], at: { day: number; time: string }): number[] {
  return messages.flatMap((m, i) => (m.time === at.time && (!m.days.length || m.days.includes(at.day)) ? [i] : []));
}

/** Messages already sent this minute (checked every 30 s, so each minute is seen at least once). */
const sent = new Set<string>();

export async function runScheduled(ctx: ModuleContext, guild: Guild, now = new Date()): Promise<void> {
  const config = ctx.config(guild.id).scheduled;
  if (!config.enabled || !config.messages.length) return;
  const at = localParts(now, config.timezone) ?? localParts(now, 'UTC')!;
  if (sent.size > 2000) sent.clear();
  for (const i of dueMessages(config.messages, at)) {
    const key = `${guild.id}:${i}:${at.date} ${at.time}`;
    if (sent.has(key)) continue;
    sent.add(key);
    const m = config.messages[i]!;
    const channel = await sendableChannel(ctx, guild, m.channelId, 'Scheduled messages');
    await channel
      ?.send({ content: m.roleId ? `<@&${m.roleId}> ${m.text}` : m.text, allowedMentions: { parse: [], roles: m.roleId ? [m.roleId] : [] } })
      .catch((e: Error) => ctx.log('warn', `Scheduled messages: could not post: ${e.message}`));
  }
}
