import type { AnalyticsReport } from '@delyforge/shared';
import type { LocalDatabase } from './database';

/** Heartbeats arrive every few seconds; a longer gap means the bot was down, so it isn't counted as online time. */
const MAX_HEARTBEAT_GAP_MS = 60_000;

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Per-bot daily statistics (counts only — no message content), kept on this computer. */
export class AnalyticsRepository {
  private readonly lastBeat = new Map<string, number>();

  constructor(private readonly db: LocalDatabase) {}

  private bump(botId: string, t: number, column: 'commands' | 'command_errors' | 'crashes' | 'online_seconds', by = 1): void {
    this.db
      .prepare(`INSERT INTO bot_stats_daily (bot_id, day, ${column}) VALUES (?, ?, ?) ON CONFLICT (bot_id, day) DO UPDATE SET ${column} = ${column} + excluded.${column}`)
      .run(botId, day(t), by);
  }

  command(botId: string, name: string, ok: boolean, durationMs: number, t = Date.now()): void {
    this.bump(botId, t, 'commands');
    if (!ok) this.bump(botId, t, 'command_errors');
    this.db
      .prepare(
        `INSERT INTO command_stats_daily (bot_id, day, name, uses, errors, total_ms) VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT (bot_id, day, name) DO UPDATE SET uses = uses + 1, errors = errors + excluded.errors, total_ms = total_ms + excluded.total_ms`,
      )
      .run(botId, day(t), name.slice(0, 100), ok ? 0 : 1, Math.round(durationMs));
  }

  heartbeat(botId: string, t = Date.now()): void {
    const last = this.lastBeat.get(botId);
    this.lastBeat.set(botId, t);
    // shortcut: online time is credited to the day the heartbeat lands on (a gap spanning midnight counts for the new day).
    if (last !== undefined && t - last <= MAX_HEARTBEAT_GAP_MS && t > last) this.bump(botId, t, 'online_seconds', Math.round((t - last) / 1000));
  }

  crash(botId: string, t = Date.now()): void {
    this.lastBeat.delete(botId);
    this.bump(botId, t, 'crashes');
  }

  stopped(botId: string): void {
    this.lastBeat.delete(botId);
  }

  /** Daily totals for the last `days` days (oldest first, missing days filled with zeros) plus the most used commands. */
  report(days: number, botId: string | null, now = Date.now()): AnalyticsReport {
    const from = day(now - (days - 1) * 86_400_000);
    const where = `day >= ?${botId ? ' AND bot_id = ?' : ''}`;
    const args = botId ? [from, botId] : [from];
    const rows = this.db
      .prepare(`SELECT day, SUM(online_seconds) AS online, SUM(commands) AS commands, SUM(command_errors) AS errors, SUM(crashes) AS crashes FROM bot_stats_daily WHERE ${where} GROUP BY day`)
      .all(...args) as { day: string; online: number; commands: number; errors: number; crashes: number }[];
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const daily = Array.from({ length: days }, (_, i) => {
      const d = day(now - (days - 1 - i) * 86_400_000);
      const r = byDay.get(d);
      return { day: d, onlineSeconds: r?.online ?? 0, commands: r?.commands ?? 0, errors: r?.errors ?? 0, crashes: r?.crashes ?? 0 };
    });
    const top = this.db
      .prepare(`SELECT name, SUM(uses) AS uses, SUM(errors) AS errors, SUM(total_ms) AS ms FROM command_stats_daily WHERE ${where} GROUP BY name ORDER BY uses DESC LIMIT 20`)
      .all(...args) as { name: string; uses: number; errors: number; ms: number }[];
    return { days, daily, topCommands: top.map((c) => ({ name: c.name, uses: c.uses, errors: c.errors, avgMs: c.uses ? Math.round(c.ms / c.uses) : 0 })) };
  }

  /** Spreadsheet-friendly export: one row per bot per day. */
  csv(days: number, botName: (botId: string) => string, now = Date.now()): string {
    const rows = this.db
      .prepare('SELECT bot_id, day, online_seconds, commands, command_errors, crashes FROM bot_stats_daily WHERE day >= ? ORDER BY day, bot_id')
      .all(day(now - (days - 1) * 86_400_000)) as { bot_id: string; day: string; online_seconds: number; commands: number; command_errors: number; crashes: number }[];
    // Quoted, and a leading ' stops spreadsheet apps treating a name like "=cmd()" as a formula.
    const text = (v: string) => `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replaceAll('"', '""')}"`;
    return [
      'date,bot,online_hours,commands,command_errors,crashes',
      ...rows.map((r) => [r.day, text(botName(r.bot_id)), (r.online_seconds / 3600).toFixed(2), r.commands, r.command_errors, r.crashes].join(',')),
    ].join('\n');
  }
}
