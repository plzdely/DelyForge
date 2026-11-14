import type { AppNotification, BotLogEntry, LogLevel, NotificationType } from '@delyforge/shared';
import type { LocalDatabase } from './database';

const MAX_LINES_PER_BOT = 5000;

interface LogRow {
  id: number;
  bot_id: string;
  level: LogLevel;
  message: string;
  created_at: string;
}

const toEntry = (r: LogRow): BotLogEntry => ({
  id: r.id,
  botId: r.bot_id,
  level: r.level,
  message: r.message,
  createdAt: r.created_at,
});

/** Per-bot console history. Messages must already be redacted by the caller. */
export class LogRepository {
  private appendsSincePrune = 0;

  constructor(private readonly db: LocalDatabase) {}

  append(botId: string, level: LogLevel, message: string): BotLogEntry {
    const row = this.db
      .prepare('INSERT INTO bot_logs (bot_id, level, message) VALUES (?, ?, ?) RETURNING *')
      .get(botId, level, message) as unknown as LogRow;
    if (++this.appendsSincePrune >= 250) {
      this.appendsSincePrune = 0;
      this.trim(botId);
    }
    return toEntry(row);
  }

  /** Newest `limit` entries, returned oldest first (console order). */
  list(botId: string, limit = 500): BotLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM bot_logs WHERE bot_id = ? ORDER BY id DESC LIMIT ?')
      .all(botId, limit) as unknown as LogRow[];
    return rows.reverse().map(toEntry);
  }

  clear(botId: string): void {
    this.db.prepare('DELETE FROM bot_logs WHERE bot_id = ?').run(botId);
  }

  toText(botId: string): string {
    const rows = this.db.prepare('SELECT * FROM bot_logs WHERE bot_id = ? ORDER BY id').all(botId) as unknown as LogRow[];
    return rows.map((r) => `${r.created_at} [${r.level.toUpperCase()}] ${r.message}`).join('\n') + '\n';
  }

  /** Keeps each bot's console bounded in size. */
  trim(botId: string): void {
    this.db
      .prepare(
        `DELETE FROM bot_logs WHERE bot_id = ? AND id <= (
           SELECT id FROM bot_logs WHERE bot_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`,
      )
      .run(botId, botId, MAX_LINES_PER_BOT);
  }

  /** Deletes entries older than the plan's log retention. */
  pruneOlderThan(days: number): number {
    const r = this.db
      .prepare(`DELETE FROM bot_logs WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`)
      .run(`-${Math.max(1, Math.floor(days))} days`);
    return Number(r.changes);
  }
}

interface NotificationRow {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  bot_id: string | null;
  read_at: string | null;
  created_at: string;
}

const toNotification = (r: NotificationRow): AppNotification => ({
  id: r.id,
  type: r.type,
  title: r.title,
  body: r.body,
  botId: r.bot_id,
  readAt: r.read_at,
  createdAt: r.created_at,
});

export class NotificationRepository {
  constructor(private readonly db: LocalDatabase) {}

  create(type: NotificationType, title: string, body: string, botId: string | null): AppNotification {
    const row = this.db
      .prepare('INSERT INTO notifications (type, title, body, bot_id) VALUES (?, ?, ?, ?) RETURNING *')
      .get(type, title, body, botId) as unknown as NotificationRow;
    // Keep the inbox bounded.
    this.db.prepare('DELETE FROM notifications WHERE id <= (SELECT id FROM notifications ORDER BY id DESC LIMIT 1 OFFSET 500)').run();
    return toNotification(row);
  }

  list(limit = 200): AppNotification[] {
    const rows = this.db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(limit) as unknown as NotificationRow[];
    return rows.map(toNotification);
  }

  /** Marks the given notifications (or all of them) as read. */
  markRead(ids?: number[]): void {
    const now = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
    if (!ids) {
      this.db.prepare(`UPDATE notifications SET read_at = ${now} WHERE read_at IS NULL`).run();
      return;
    }
    const stmt = this.db.prepare(`UPDATE notifications SET read_at = ${now} WHERE id = ? AND read_at IS NULL`);
    for (const id of ids) stmt.run(id);
  }

  clear(): void {
    this.db.prepare('DELETE FROM notifications').run();
  }

  unreadCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').get() as { n: number }).n;
  }
}
