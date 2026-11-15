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

export interface Giveaway {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  prize: string;
  winners: number;
  hostId: string;
  endsAt: number;
  ended: boolean;
  winnerIds: string[];
}

interface GiveawayRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  prize: string;
  winners: number;
  host_id: string;
  ends_at: number;
  ended: number;
  winner_ids: string;
}

const toGiveaway = (r: GiveawayRow): Giveaway => ({
  id: r.id,
  guildId: r.guild_id,
  channelId: r.channel_id,
  messageId: r.message_id,
  prize: r.prize,
  winners: r.winners,
  hostId: r.host_id,
  endsAt: r.ends_at,
  ended: r.ended === 1,
  winnerIds: JSON.parse(r.winner_ids) as string[],
});

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
      PRAGMA foreign_keys = ON;
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
      CREATE TABLE IF NOT EXISTS xp (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        xp       INTEGER NOT NULL DEFAULT 0,
        last_at  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS xp_rank_idx ON xp (guild_id, xp DESC);
      CREATE TABLE IF NOT EXISTS panels (
        guild_id   TEXT NOT NULL,
        key        TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        hash       TEXT NOT NULL,
        PRIMARY KEY (guild_id, key)
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id   TEXT NOT NULL,
        channel_id TEXT NOT NULL UNIQUE,
        user_id    TEXT NOT NULL,
        opened_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        closed_at  TEXT
      );
      CREATE TABLE IF NOT EXISTS suggestions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id   TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        user_id    TEXT NOT NULL,
        content    TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS suggestion_votes (
        suggestion_id INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
        user_id       TEXT NOT NULL,
        vote          INTEGER NOT NULL,
        PRIMARY KEY (suggestion_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS giveaways (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id   TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        prize      TEXT NOT NULL,
        winners    INTEGER NOT NULL,
        host_id    TEXT NOT NULL,
        ends_at    INTEGER NOT NULL,
        ended      INTEGER NOT NULL DEFAULT 0,
        winner_ids TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS giveaway_entries (
        giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL,
        PRIMARY KEY (giveaway_id, user_id)
      );
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

  // ─── Leveling ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Adds XP unless the member is still on cooldown. Returns totals before/after, or null when on cooldown. */
  addXp(guildId: string, userId: string, amount: number, now: number, cooldownMs: number): { before: number; after: number } | null {
    const row = this.db.prepare('SELECT xp, last_at FROM xp WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as
      | { xp: number; last_at: number }
      | undefined;
    if (row && now - row.last_at < cooldownMs) return null;
    const before = row?.xp ?? 0;
    this.db
      .prepare(
        `INSERT INTO xp (guild_id, user_id, xp, last_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = xp + excluded.xp, last_at = excluded.last_at`,
      )
      .run(guildId, userId, amount, now);
    return { before, after: before + amount };
  }

  xpOf(guildId: string, userId: string): { xp: number; rank: number } {
    const row = this.db.prepare('SELECT xp FROM xp WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as { xp: number } | undefined;
    const xp = row?.xp ?? 0;
    const above = (this.db.prepare('SELECT COUNT(*) AS n FROM xp WHERE guild_id = ? AND xp > ?').get(guildId, xp) as { n: number }).n;
    return { xp, rank: above + 1 };
  }

  leaderboard(guildId: string, limit = 10): { userId: string; xp: number }[] {
    const rows = this.db.prepare('SELECT user_id, xp FROM xp WHERE guild_id = ? ORDER BY xp DESC LIMIT ?').all(guildId, limit) as { user_id: string; xp: number }[];
    return rows.map((r) => ({ userId: r.user_id, xp: r.xp }));
  }

  // ─── Panels the bot posted ───────────────────────────────────────────────────────────────────────────────────────

  panels(guildId: string): { key: string; channelId: string; messageId: string; hash: string }[] {
    const rows = this.db.prepare('SELECT * FROM panels WHERE guild_id = ?').all(guildId) as { key: string; channel_id: string; message_id: string; hash: string }[];
    return rows.map((r) => ({ key: r.key, channelId: r.channel_id, messageId: r.message_id, hash: r.hash }));
  }

  savePanel(guildId: string, key: string, channelId: string, messageId: string, hash: string): void {
    this.db
      .prepare(
        `INSERT INTO panels (guild_id, key, channel_id, message_id, hash) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, key) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, hash = excluded.hash`,
      )
      .run(guildId, key, channelId, messageId, hash);
  }

  removePanel(guildId: string, key: string): void {
    this.db.prepare('DELETE FROM panels WHERE guild_id = ? AND key = ?').run(guildId, key);
  }

  // ─── Tickets ─────────────────────────────────────────────────────────────────────────────────────────────────────

  openTickets(guildId: string, userId: string): string[] {
    const rows = this.db.prepare('SELECT channel_id FROM tickets WHERE guild_id = ? AND user_id = ? AND closed_at IS NULL').all(guildId, userId) as { channel_id: string }[];
    return rows.map((r) => r.channel_id);
  }

  /** The number the next ticket will get, so its channel can be named after it. */
  nextTicketNumber(guildId: string): number {
    return (this.db.prepare('SELECT COUNT(*) + 1 AS n FROM tickets WHERE guild_id = ?').get(guildId) as { n: number }).n;
  }

  addTicket(guildId: string, channelId: string, userId: string): void {
    this.db.prepare('INSERT INTO tickets (guild_id, channel_id, user_id) VALUES (?, ?, ?)').run(guildId, channelId, userId);
  }

  ticketByChannel(channelId: string): { id: number; userId: string; openedAt: string; closed: boolean } | null {
    const r = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) as
      | { id: number; user_id: string; opened_at: string; closed_at: string | null }
      | undefined;
    return r ? { id: r.id, userId: r.user_id, openedAt: r.opened_at, closed: r.closed_at !== null } : null;
  }

  /** Marks a ticket closed; false if it was already closed (two staff clicking Close don't both run it). */
  closeTicket(channelId: string): boolean {
    const r = this.db.prepare("UPDATE tickets SET closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE channel_id = ? AND closed_at IS NULL").run(channelId);
    return Number(r.changes) === 1;
  }

  // ─── Suggestions ─────────────────────────────────────────────────────────────────────────────────────────────────

  addSuggestion(guildId: string, channelId: string, userId: string, content: string): number {
    const r = this.db.prepare('INSERT INTO suggestions (guild_id, channel_id, user_id, content) VALUES (?, ?, ?, ?)').run(guildId, channelId, userId, content);
    return Number(r.lastInsertRowid);
  }

  setSuggestionMessage(id: number, messageId: string): void {
    this.db.prepare('UPDATE suggestions SET message_id = ? WHERE id = ?').run(messageId, id);
  }

  suggestion(id: number): { id: number; guildId: string; userId: string; content: string; status: string } | null {
    const r = this.db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id) as
      | { id: number; guild_id: string; user_id: string; content: string; status: string }
      | undefined;
    return r ? { id: r.id, guildId: r.guild_id, userId: r.user_id, content: r.content, status: r.status } : null;
  }

  setSuggestionStatus(id: number, status: 'approved' | 'rejected'): void {
    this.db.prepare('UPDATE suggestions SET status = ? WHERE id = ?').run(status, id);
  }

  /** Records a vote; voting the same way again takes it back. Returns the new totals. */
  vote(id: number, userId: string, vote: 1 | -1): { up: number; down: number } {
    const existing = this.db.prepare('SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?').get(id, userId) as { vote: number } | undefined;
    if (existing?.vote === vote) {
      this.db.prepare('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?').run(id, userId);
    } else {
      this.db
        .prepare('INSERT INTO suggestion_votes (suggestion_id, user_id, vote) VALUES (?, ?, ?) ON CONFLICT(suggestion_id, user_id) DO UPDATE SET vote = excluded.vote')
        .run(id, userId, vote);
    }
    return this.votes(id);
  }

  votes(id: number): { up: number; down: number } {
    const r = this.db
      .prepare('SELECT COALESCE(SUM(vote = 1), 0) AS up, COALESCE(SUM(vote = -1), 0) AS down FROM suggestion_votes WHERE suggestion_id = ?')
      .get(id) as { up: number; down: number };
    return { up: r.up, down: r.down };
  }

  // ─── Giveaways ───────────────────────────────────────────────────────────────────────────────────────────────────

  addGiveaway(g: { guildId: string; channelId: string; prize: string; winners: number; hostId: string; endsAt: number }): number {
    const r = this.db
      .prepare('INSERT INTO giveaways (guild_id, channel_id, prize, winners, host_id, ends_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(g.guildId, g.channelId, g.prize, g.winners, g.hostId, g.endsAt);
    return Number(r.lastInsertRowid);
  }

  setGiveawayMessage(id: number, messageId: string): void {
    this.db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(messageId, id);
  }

  giveaway(id: number): Giveaway | null {
    const r = this.db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id) as GiveawayRow | undefined;
    return r ? toGiveaway(r) : null;
  }

  dueGiveaways(now: number): Giveaway[] {
    return (this.db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ?').all(now) as unknown as GiveawayRow[]).map(toGiveaway);
  }

  /** Enter, or leave if already entered. Returns whether the member is now entered and the entry count. */
  toggleEntry(id: number, userId: string): { entered: boolean; count: number } {
    const removed = Number(this.db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(id, userId).changes) === 1;
    if (!removed) this.db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)').run(id, userId);
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?').get(id) as { n: number }).n;
    return { entered: !removed, count };
  }

  entries(id: number): string[] {
    return (this.db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(id) as { user_id: string }[]).map((r) => r.user_id);
  }

  /** Marks a giveaway ended; false if something else already ended it (timer and /giveaway end at once). */
  endGiveaway(id: number, winnerIds: string[]): boolean {
    const r = this.db.prepare('UPDATE giveaways SET ended = 1, winner_ids = ? WHERE id = ? AND ended = 0').run(JSON.stringify(winnerIds), id);
    return Number(r.changes) === 1;
  }

  setWinners(id: number, winnerIds: string[]): void {
    this.db.prepare('UPDATE giveaways SET winner_ids = ? WHERE id = ?').run(JSON.stringify(winnerIds), id);
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
