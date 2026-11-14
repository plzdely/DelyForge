import {
  type ActivityItem,
  type ActivityKind,
  type AppSettings,
  type AppSettingsPatch,
  DEFAULT_APP_SETTINGS,
  type DashboardSummary,
  appSettingsSchema,
} from '@delyforge/shared';
import type { LocalDatabase } from './database';

// ─── Settings ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class SettingsRepository {
  constructor(private readonly db: LocalDatabase) {}

  get(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const stored: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value);
      } catch {
        // Ignore a corrupted value; the default will be used instead.
      }
    }
    // Validate field by field so one bad value never resets every other setting.
    const merged: Record<string, unknown> = { ...DEFAULT_APP_SETTINGS };
    const shape = appSettingsSchema.shape;
    for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
      if (key in stored && shape[key].safeParse(stored[key]).success) merged[key] = stored[key];
    }
    return appSettingsSchema.parse(merged);
  }

  update(patch: AppSettingsPatch): AppSettings {
    const upsert = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    );
    this.db.exec('BEGIN');
    try {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) upsert.run(key, JSON.stringify(value));
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.get();
  }
}

// ─── Activity ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class ActivityRepository {
  constructor(private readonly db: LocalDatabase) {}

  record(kind: ActivityKind, message: string, botId: string | null = null): void {
    this.db.prepare('INSERT INTO activity (kind, message, bot_id) VALUES (?, ?, ?)').run(kind, message, botId);
  }

  recent(limit = 10): ActivityItem[] {
    const rows = this.db
      .prepare('SELECT id, kind, message, created_at FROM activity ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as { id: number; kind: ActivityKind; message: string; created_at: string }[];
    return rows.map((r) => ({ id: r.id, kind: r.kind, message: r.message, createdAt: r.created_at }));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM activity').get() as { n: number }).n;
  }
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────────────────────────────────────────

export class DashboardRepository {
  constructor(
    private readonly db: LocalDatabase,
    private readonly activity: ActivityRepository,
    /** Number of bots currently running — supplied by the bot supervisor (Phase 3). */
    private readonly runningBotCount: () => number,
  ) {}

  summary(): DashboardSummary {
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM bot_projects').get() as { n: number }).n;
    const online = Math.min(this.runningBotCount(), total);
    return {
      totalProjects: total,
      onlineBots: online,
      offlineBots: total - online,
      recentActivity: this.activity.recent(8),
      localPlanId: 'free',
      accountConnected: false,
    };
  }
}
