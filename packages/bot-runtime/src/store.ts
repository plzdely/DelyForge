import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Warning {
  id: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
  createdAt: string;
}

export interface ManagedCommand {
  guildId: string;
  name: string;
  commandId: string;
  hash: string;
}

/**
 * The bot's own data, kept by its runtime process in `<dataDir>/bot-<botUserId>.db`.
 * (Warnings, which slash commands DelyForge created; later XP, tickets, giveaways…)
 */
export class BotStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS managed_commands (
        guild_id   TEXT NOT NULL,
        name       TEXT NOT NULL,
        command_id TEXT NOT NULL,
        hash       TEXT NOT NULL,
        PRIMARY KEY (guild_id, name)
      );
      CREATE TABLE IF NOT EXISTS warnings (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id     TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason       TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS warnings_member_idx ON warnings (guild_id, user_id);
    `);
  }

  static open(dataDir: string, botUserId: string): BotStore {
    mkdirSync(dataDir, { recursive: true });
    return new BotStore(join(dataDir, `bot-${botUserId.replace(/\D/g, '')}.db`));
  }

  // ─── Warnings ────────────────────────────────────────────────────────────────────────────────────────────────────

  addWarning(guildId: string, userId: string, moderatorId: string, reason: string): number {
    this.db.prepare('INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)').run(guildId, userId, moderatorId, reason);
    return this.warningCount(guildId, userId);
  }

  warnings(guildId: string, userId: string): Warning[] {
    const rows = this.db
      .prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 25')
      .all(guildId, userId) as { id: number; guild_id: string; user_id: string; moderator_id: string; reason: string; created_at: string }[];
    return rows.map((r) => ({ id: r.id, guildId: r.guild_id, userId: r.user_id, moderatorId: r.moderator_id, reason: r.reason, createdAt: r.created_at }));
  }

  warningCount(guildId: string, userId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM warnings WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as { n: number }).n;
  }

  clearWarnings(guildId: string, userId: string): number {
    return Number(this.db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes);
  }

  // ─── Commands DelyForge created ──────────────────────────────────────────────────────────────────────────────────

  managedCommands(guildId: string): ManagedCommand[] {
    const rows = this.db.prepare('SELECT * FROM managed_commands WHERE guild_id = ?').all(guildId) as {
      guild_id: string;
      name: string;
      command_id: string;
      hash: string;
    }[];
    return rows.map((r) => ({ guildId: r.guild_id, name: r.name, commandId: r.command_id, hash: r.hash }));
  }

  saveManagedCommand(c: ManagedCommand): void {
    this.db
      .prepare(
        `INSERT INTO managed_commands (guild_id, name, command_id, hash) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, name) DO UPDATE SET command_id = excluded.command_id, hash = excluded.hash`,
      )
      .run(c.guildId, c.name, c.commandId, c.hash);
  }

  removeManagedCommand(guildId: string, name: string): void {
    this.db.prepare('DELETE FROM managed_commands WHERE guild_id = ? AND name = ?').run(guildId, name);
  }

  close(): void {
    this.db.close();
  }
}

/** Decide which commands to create, update or delete so a server matches the enabled modules. */
export function planCommandSync(
  desired: readonly { name: string; hash: string }[],
  managed: readonly ManagedCommand[],
): { create: string[]; update: ManagedCommand[]; remove: ManagedCommand[] } {
  const want = new Map(desired.map((d) => [d.name, d.hash]));
  const have = new Map(managed.map((m) => [m.name, m]));
  return {
    create: desired.filter((d) => !have.has(d.name)).map((d) => d.name),
    update: managed.filter((m) => want.has(m.name) && want.get(m.name) !== m.hash),
    // Only commands DelyForge created itself are ever removed.
    remove: managed.filter((m) => !want.has(m.name)),
  };
}
