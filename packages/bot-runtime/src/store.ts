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
  /** Only members with this role may enter (null = anyone). */
  requiredRoleId: string | null;
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
  required_role_id: string | null;
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
  requiredRoleId: r.required_role_id,
});

export interface EconomyAccount {
  wallet: number;
  bank: number;
  lastDaily: number | null;
  streak: number;
  lastWork: number | null;
  lastRob: number | null;
  lastChat: number | null;
}

export interface ModCase {
  number: number;
  /** warn, timeout, untimeout, kick, ban, tempban, unban, note, automod */
  type: string;
  userId: string;
  moderatorId: string;
  reason: string;
  /** For timeouts and temporary bans, e.g. "1d". */
  duration: string | null;
  createdAt: number;
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
      PRAGMA foreign_keys = ON;
      -- The DelyForge app also opens this file (Members tab); wait briefly instead of failing if both write at once.
      PRAGMA busy_timeout = 3000;
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
      CREATE TABLE IF NOT EXISTS member_names (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        name     TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
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
      CREATE TABLE IF NOT EXISTS invite_joins (
        guild_id   TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        inviter_id TEXT,
        code       TEXT,
        joined_at  INTEGER NOT NULL,
        left_at    INTEGER,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS invite_joins_inviter_idx ON invite_joins (guild_id, inviter_id);
      CREATE TABLE IF NOT EXISTS starboard (
        guild_id        TEXT NOT NULL,
        message_id      TEXT NOT NULL,
        star_message_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, message_id)
      );
      CREATE TABLE IF NOT EXISTS temp_channels (
        channel_id TEXT PRIMARY KEY,
        guild_id   TEXT NOT NULL,
        owner_id   TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mod_cases (
        guild_id     TEXT NOT NULL,
        number       INTEGER NOT NULL,
        type         TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason       TEXT NOT NULL,
        duration     TEXT,
        created_at   INTEGER NOT NULL,
        PRIMARY KEY (guild_id, number)
      );
      CREATE INDEX IF NOT EXISTS mod_cases_user_idx ON mod_cases (guild_id, user_id);
      CREATE TABLE IF NOT EXISTS temp_bans (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        unban_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS reminders (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id   TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        text       TEXT NOT NULL,
        due_at     INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scheduled_posts (
        post_key   TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_vars (
        guild_id TEXT NOT NULL,
        name     TEXT NOT NULL,
        value    TEXT NOT NULL,
        PRIMARY KEY (guild_id, name)
      );
      CREATE TABLE IF NOT EXISTS channel_locks (
        channel_id TEXT PRIMARY KEY,
        guild_id   TEXT NOT NULL,
        allow      TEXT NOT NULL,
        deny       TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feed_seen (
        guild_id TEXT NOT NULL,
        feed_key TEXT NOT NULL,
        item_id  TEXT NOT NULL,
        seen_at  INTEGER NOT NULL,
        PRIMARY KEY (guild_id, feed_key, item_id)
      );
      CREATE TABLE IF NOT EXISTS modmail_threads (
        guild_id  TEXT NOT NULL,
        user_id   TEXT NOT NULL,
        thread_id TEXT NOT NULL UNIQUE,
        open      INTEGER NOT NULL DEFAULT 1,
        opened_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS modmail_blocks (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS applications (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id   TEXT NOT NULL,
        form_id    TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        answers    TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        decided_at INTEGER,
        decided_by TEXT
      );
      CREATE TABLE IF NOT EXISTS economy (
        guild_id   TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        wallet     INTEGER NOT NULL,
        bank       INTEGER NOT NULL DEFAULT 0,
        last_daily INTEGER,
        streak     INTEGER NOT NULL DEFAULT 0,
        last_work  INTEGER,
        last_rob   INTEGER,
        last_chat  INTEGER,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS economy_items (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        item_id  TEXT NOT NULL,
        count    INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id, item_id)
      );
      CREATE TABLE IF NOT EXISTS counting (
        guild_id     TEXT PRIMARY KEY,
        count        INTEGER NOT NULL DEFAULT 0,
        last_user_id TEXT,
        record       INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS counting_users (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        n        INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS temp_roles (
        guild_id  TEXT NOT NULL,
        user_id   TEXT NOT NULL,
        role_id   TEXT NOT NULL,
        remove_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id, role_id)
      );
      CREATE TABLE IF NOT EXISTS afk (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        reason   TEXT NOT NULL,
        since    INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS confessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id   TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        text       TEXT NOT NULL,
        image      TEXT,
        status     TEXT NOT NULL,
        number     INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS confession_bans (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS highlights (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        word     TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id, word)
      );
      CREATE TABLE IF NOT EXISTS highlight_ignores (
        guild_id   TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id, channel_id)
      );
      CREATE TABLE IF NOT EXISTS channel_posts (
        channel_id TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        at         INTEGER NOT NULL,
        PRIMARY KEY (channel_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS activity_daily (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        day      TEXT NOT NULL,
        messages INTEGER NOT NULL DEFAULT 0,
        voice    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id, day)
      );
      CREATE TABLE IF NOT EXISTS reputation (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        reps     INTEGER NOT NULL DEFAULT 0,
        given_at INTEGER,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS member_snapshots (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        roles    TEXT NOT NULL,
        nick     TEXT,
        left_at  INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS ticket_blacklist (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS shop_counters (
        guild_id TEXT NOT NULL,
        key      TEXT NOT NULL,
        n        INTEGER NOT NULL,
        PRIMARY KEY (guild_id, key)
      );
      CREATE TABLE IF NOT EXISTS birthdays (
        guild_id       TEXT NOT NULL,
        user_id        TEXT NOT NULL,
        month          INTEGER NOT NULL,
        day            INTEGER NOT NULL,
        announced_year INTEGER,
        PRIMARY KEY (guild_id, user_id)
      );
    `);
    // Columns added after the first release: create them in databases made by older versions.
    this.addColumnIfMissing('giveaways', 'required_role_id', 'TEXT');
    this.addColumnIfMissing('suggestions', 'reason', 'TEXT');
    this.addColumnIfMissing('giveaway_entries', 'weight', 'INTEGER NOT NULL DEFAULT 1');
    this.addColumnIfMissing('tickets', 'reason', 'TEXT');
    this.addColumnIfMissing('tickets', 'claimed_by', 'TEXT');
    this.addColumnIfMissing('tickets', 'panel_id', 'TEXT');
    this.addColumnIfMissing('starboard', 'author_id', 'TEXT');
    this.addColumnIfMissing('starboard', 'stars', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfMissing('economy', 'last_beg', 'INTEGER');
    this.addColumnIfMissing('economy', 'last_crime', 'INTEGER');
  }

  private addColumnIfMissing(table: string, column: string, type: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  static open(dataDir: string, botUserId: string): BotStore {
    mkdirSync(dataDir, { recursive: true });
    return new BotStore(join(dataDir, `bot-${botUserId.replace(/\D/g, '')}.db`));
  }

  // ─── Warnings ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Adds a warning; returns how many still count (newer than `sinceMs`, 0 = all). */
  addWarning(guildId: string, userId: string, moderatorId: string, reason: string, sinceMs = 0): number {
    this.db.prepare('INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)').run(guildId, userId, moderatorId, reason);
    return this.warningCount(guildId, userId, sinceMs);
  }

  warnings(guildId: string, userId: string, sinceMs = 0): Warning[] {
    const rows = this.db
      .prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 25')
      .all(guildId, userId, new Date(sinceMs).toISOString()) as { id: number; guild_id: string; user_id: string; moderator_id: string; reason: string; created_at: string }[];
    return rows.map((r) => ({ id: r.id, guildId: r.guild_id, userId: r.user_id, moderatorId: r.moderator_id, reason: r.reason, createdAt: r.created_at }));
  }

  warningCount(guildId: string, userId: string, sinceMs = 0): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM warnings WHERE guild_id = ? AND user_id = ? AND created_at >= ?').get(guildId, userId, new Date(sinceMs).toISOString()) as { n: number }).n;
  }

  /** Removes one warning by its ID; false if it isn't this member's. */
  removeWarning(guildId: string, userId: string, id: number): boolean {
    return Number(this.db.prepare('DELETE FROM warnings WHERE id = ? AND guild_id = ? AND user_id = ?').run(id, guildId, userId).changes) === 1;
  }

  /** Giveaways still running in a server, soonest to end first. */
  runningGiveaways(guildId: string): { id: number; prize: string; channelId: string; endsAt: number; entries: number }[] {
    const rows = this.db
      .prepare(
        `SELECT g.id, g.prize, g.channel_id, g.ends_at, (SELECT COUNT(*) FROM giveaway_entries e WHERE e.giveaway_id = g.id) AS entries
         FROM giveaways g WHERE g.guild_id = ? AND g.ended = 0 ORDER BY g.ends_at LIMIT 20`,
      )
      .all(guildId) as { id: number; prize: string; channel_id: string; ends_at: number; entries: number }[];
    return rows.map((r) => ({ id: r.id, prize: r.prize, channelId: r.channel_id, endsAt: r.ends_at, entries: r.entries }));
  }

  clearWarnings(guildId: string, userId: string): number {
    return Number(this.db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes);
  }

  /** Every warning in a server, newest first (for the app's Members tab). */
  allWarnings(guildId: string, limit = 500): Warning[] {
    const rows = this.db
      .prepare('SELECT * FROM warnings WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
      .all(guildId, limit) as { id: number; guild_id: string; user_id: string; moderator_id: string; reason: string; created_at: string }[];
    return rows.map((r) => ({ id: r.id, guildId: r.guild_id, userId: r.user_id, moderatorId: r.moderator_id, reason: r.reason, createdAt: r.created_at }));
  }

  deleteWarning(guildId: string, id: number): boolean {
    return Number(this.db.prepare('DELETE FROM warnings WHERE guild_id = ? AND id = ?').run(guildId, id).changes) === 1;
  }

  // ─── Names (so the app can show people, not ID numbers) ─────────────────────────────────────────────────────────

  rememberName(guildId: string, userId: string, name: string): void {
    this.db
      .prepare('INSERT INTO member_names (guild_id, user_id, name) VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET name = excluded.name')
      .run(guildId, userId, name.slice(0, 100));
  }

  names(guildId: string): Map<string, string> {
    const rows = this.db.prepare('SELECT user_id, name FROM member_names WHERE guild_id = ?').all(guildId) as { user_id: string; name: string }[];
    return new Map(rows.map((r) => [r.user_id, r.name]));
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

  /** Staff tools: sets a member's XP to an exact amount (never below 0). Returns before/after. */
  setXp(guildId: string, userId: string, xp: number): { before: number; after: number } {
    const before = this.xpOf(guildId, userId).xp;
    const after = Math.max(0, Math.round(xp));
    this.db
      .prepare('INSERT INTO xp (guild_id, user_id, xp, last_at) VALUES (?, ?, ?, 0) ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = excluded.xp')
      .run(guildId, userId, after);
    return { before, after };
  }

  /** Resets one member's XP, or everyone's in the server when no member is given. Returns how many were reset. */
  resetXp(guildId: string, userId: string | null): number {
    return Number(
      (userId ? this.db.prepare('DELETE FROM xp WHERE guild_id = ? AND user_id = ?').run(guildId, userId) : this.db.prepare('DELETE FROM xp WHERE guild_id = ?').run(guildId)).changes,
    );
  }

  leaderboard(guildId: string, limit = 10, offset = 0): { userId: string; xp: number }[] {
    const rows = this.db.prepare('SELECT user_id, xp FROM xp WHERE guild_id = ? ORDER BY xp DESC LIMIT ? OFFSET ?').all(guildId, limit, offset) as { user_id: string; xp: number }[];
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

  /** `panelId` = which extra ticket panel opened it (null = the main panel). */
  addTicket(guildId: string, channelId: string, userId: string, reason: string | null = null, panelId: string | null = null): void {
    this.db.prepare('INSERT INTO tickets (guild_id, channel_id, user_id, reason, panel_id) VALUES (?, ?, ?, ?, ?)').run(guildId, channelId, userId, reason, panelId);
  }

  ticketByChannel(channelId: string): { id: number; userId: string; openedAt: string; closed: boolean; reason: string | null; claimedBy: string | null; panelId: string | null } | null {
    const r = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) as
      | { id: number; user_id: string; opened_at: string; closed_at: string | null; reason: string | null; claimed_by: string | null; panel_id: string | null }
      | undefined;
    return r ? { id: r.id, userId: r.user_id, openedAt: r.opened_at, closed: r.closed_at !== null, reason: r.reason, claimedBy: r.claimed_by, panelId: r.panel_id } : null;
  }

  /** Every open ticket in a server (for closing idle ones). */
  openTicketsInGuild(guildId: string): { channelId: string; userId: string; openedAt: string; reason: string | null; claimedBy: string | null; panelId: string | null }[] {
    const rows = this.db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND closed_at IS NULL').all(guildId) as {
      channel_id: string;
      user_id: string;
      opened_at: string;
      reason: string | null;
      claimed_by: string | null;
      panel_id: string | null;
    }[];
    return rows.map((r) => ({ channelId: r.channel_id, userId: r.user_id, openedAt: r.opened_at, reason: r.reason, claimedBy: r.claimed_by, panelId: r.panel_id }));
  }

  /** A staff member takes the ticket; false if someone already did. */
  claimTicket(channelId: string, staffId: string): boolean {
    return Number(this.db.prepare('UPDATE tickets SET claimed_by = ? WHERE channel_id = ? AND claimed_by IS NULL AND closed_at IS NULL').run(staffId, channelId).changes) === 1;
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

  suggestion(id: number): { id: number; guildId: string; userId: string; content: string; status: string; reason: string | null } | null {
    const r = this.db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id) as
      | { id: number; guild_id: string; user_id: string; content: string; status: string; reason: string | null }
      | undefined;
    return r ? { id: r.id, guildId: r.guild_id, userId: r.user_id, content: r.content, status: r.status, reason: r.reason } : null;
  }

  /** Decides an open suggestion once; false if it was already decided (two staff clicking at once). */
  setSuggestionStatus(id: number, status: 'approved' | 'rejected', reason: string | null = null): boolean {
    return Number(this.db.prepare("UPDATE suggestions SET status = ?, reason = ? WHERE id = ? AND status = 'open'").run(status, reason, id).changes) === 1;
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

  addGiveaway(g: { guildId: string; channelId: string; prize: string; winners: number; hostId: string; endsAt: number; requiredRoleId?: string | null }): number {
    const r = this.db
      .prepare('INSERT INTO giveaways (guild_id, channel_id, prize, winners, host_id, ends_at, required_role_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(g.guildId, g.channelId, g.prize, g.winners, g.hostId, g.endsAt, g.requiredRoleId ?? null);
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
  toggleEntry(id: number, userId: string, weight = 1): { entered: boolean; count: number } {
    const removed = Number(this.db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(id, userId).changes) === 1;
    if (!removed) this.db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id, weight) VALUES (?, ?, ?)').run(id, userId, weight);
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?').get(id) as { n: number }).n;
    return { entered: !removed, count };
  }

  /** Entries with their weight (bonus entries from roles). */
  weightedEntries(id: number): { userId: string; weight: number }[] {
    return (this.db.prepare('SELECT user_id, weight FROM giveaway_entries WHERE giveaway_id = ?').all(id) as { user_id: string; weight: number }[]).map((r) => ({ userId: r.user_id, weight: r.weight }));
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

  // ─── Moderation cases ────────────────────────────────────────────────────────────────────────────────────────────

  /** Records a moderation case and returns its number (1, 2, 3… per server). */
  addCase(c: { guildId: string; type: string; userId: string; moderatorId: string; reason: string; duration?: string | null }, at = Date.now()): number {
    const next = (this.db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM mod_cases WHERE guild_id = ?').get(c.guildId) as { n: number }).n;
    this.db
      .prepare('INSERT INTO mod_cases (guild_id, number, type, user_id, moderator_id, reason, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(c.guildId, next, c.type, c.userId, c.moderatorId, c.reason, c.duration ?? null, at);
    return next;
  }

  private static toCase(r: { number: number; type: string; user_id: string; moderator_id: string; reason: string; duration: string | null; created_at: number }): ModCase {
    return { number: r.number, type: r.type, userId: r.user_id, moderatorId: r.moderator_id, reason: r.reason, duration: r.duration, createdAt: r.created_at };
  }

  cases(guildId: string, userId: string, limit = 25): ModCase[] {
    const rows = this.db.prepare('SELECT * FROM mod_cases WHERE guild_id = ? AND user_id = ? ORDER BY number DESC LIMIT ?').all(guildId, userId, limit) as Parameters<typeof BotStore.toCase>[0][];
    return rows.map(BotStore.toCase);
  }

  caseByNumber(guildId: string, number: number): ModCase | null {
    const r = this.db.prepare('SELECT * FROM mod_cases WHERE guild_id = ? AND number = ?').get(guildId, number) as Parameters<typeof BotStore.toCase>[0] | undefined;
    return r ? BotStore.toCase(r) : null;
  }

  // ─── Reminders ───────────────────────────────────────────────────────────────────────────────────────────────────

  addReminder(r: { guildId: string; channelId: string; userId: string; text: string; dueAt: number }): number {
    return Number(this.db.prepare('INSERT INTO reminders (guild_id, channel_id, user_id, text, due_at) VALUES (?, ?, ?, ?, ?)').run(r.guildId, r.channelId, r.userId, r.text, r.dueAt).lastInsertRowid);
  }

  pendingReminders(guildId: string, userId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM reminders WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as { n: number }).n;
  }

  /** Reminders that are due, removed as they're taken (so each is delivered once). */
  takeDueReminders(now: number): { guildId: string; channelId: string; userId: string; text: string; dueAt: number }[] {
    const rows = this.db.prepare('SELECT * FROM reminders WHERE due_at <= ? ORDER BY due_at LIMIT 50').all(now) as { id: number; guild_id: string; channel_id: string; user_id: string; text: string; due_at: number }[];
    const del = this.db.prepare('DELETE FROM reminders WHERE id = ?');
    return rows.filter((r) => Number(del.run(r.id).changes) === 1).map((r) => ({ guildId: r.guild_id, channelId: r.channel_id, userId: r.user_id, text: r.text, dueAt: r.due_at }));
  }

  // ─── Tickets (0.5) ───────────────────────────────────────────────────────────────────────────────────────────────

  /** Claim, unclaim (null) or hand a ticket to someone else. False when it isn't an open ticket. */
  setTicketClaim(channelId: string, staffId: string | null): boolean {
    return Number(this.db.prepare('UPDATE tickets SET claimed_by = ? WHERE channel_id = ? AND closed_at IS NULL').run(staffId, channelId).changes) === 1;
  }

  ticketStats(guildId: string, since: number): { open: number; closed: number; claims: { userId: string; n: number }[] } {
    const iso = new Date(since).toISOString();
    const open = (this.db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND closed_at IS NULL').get(guildId) as { n: number }).n;
    const closed = (this.db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND closed_at >= ?').get(guildId, iso) as { n: number }).n;
    const claims = this.db
      .prepare('SELECT claimed_by AS userId, COUNT(*) AS n FROM tickets WHERE guild_id = ? AND claimed_by IS NOT NULL AND opened_at >= ? GROUP BY claimed_by ORDER BY n DESC LIMIT 5')
      .all(guildId, iso) as { userId: string; n: number }[];
    return { open, closed, claims };
  }

  // ─── Moderation (0.5) ────────────────────────────────────────────────────────────────────────────────────────────

  setCaseReason(guildId: string, number: number, reason: string): boolean {
    return Number(this.db.prepare('UPDATE mod_cases SET reason = ? WHERE guild_id = ? AND number = ?').run(reason, guildId, number).changes) === 1;
  }

  /** Cases a moderator made, by type. */
  casesByModerator(guildId: string, moderatorId: string, since = 0): Record<string, number> {
    const rows = this.db.prepare('SELECT type, COUNT(*) AS n FROM mod_cases WHERE guild_id = ? AND moderator_id = ? AND created_at >= ? GROUP BY type').all(guildId, moderatorId, since) as { type: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.type, r.n]));
  }

  addTempRole(guildId: string, userId: string, roleId: string, removeAt: number): void {
    this.db.prepare('INSERT OR REPLACE INTO temp_roles (guild_id, user_id, role_id, remove_at) VALUES (?, ?, ?, ?)').run(guildId, userId, roleId, removeAt);
  }

  /** Temporary roles whose time is up, removed from the list as they're taken. */
  takeDueTempRoles(now: number): { guildId: string; userId: string; roleId: string }[] {
    const rows = this.db.prepare('SELECT guild_id, user_id, role_id FROM temp_roles WHERE remove_at <= ? LIMIT 50').all(now) as { guild_id: string; user_id: string; role_id: string }[];
    const del = this.db.prepare('DELETE FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?');
    return rows.filter((r) => Number(del.run(r.guild_id, r.user_id, r.role_id).changes) === 1).map((r) => ({ guildId: r.guild_id, userId: r.user_id, roleId: r.role_id }));
  }

  // ─── AFK ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  setAfk(guildId: string, userId: string, reason: string, since: number): void {
    this.db.prepare('INSERT OR REPLACE INTO afk (guild_id, user_id, reason, since) VALUES (?, ?, ?, ?)').run(guildId, userId, reason, since);
  }

  afk(guildId: string, userId: string): { reason: string; since: number } | null {
    return (this.db.prepare('SELECT reason, since FROM afk WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as { reason: string; since: number } | undefined) ?? null;
  }

  clearAfk(guildId: string, userId: string): boolean {
    return Number(this.db.prepare('DELETE FROM afk WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes) === 1;
  }

  // ─── Modmail ─────────────────────────────────────────────────────────────────────────────────────────────────────

  openModmail(guildId: string, userId: string): string | null {
    return (this.db.prepare('SELECT thread_id FROM modmail_threads WHERE guild_id = ? AND user_id = ? AND open = 1').get(guildId, userId) as { thread_id: string } | undefined)?.thread_id ?? null;
  }

  addModmail(guildId: string, userId: string, threadId: string, now: number): void {
    this.db.prepare('INSERT INTO modmail_threads (guild_id, user_id, thread_id, opened_at) VALUES (?, ?, ?, ?)').run(guildId, userId, threadId, now);
  }

  modmailByThread(threadId: string): { guildId: string; userId: string; open: boolean } | null {
    const r = this.db.prepare('SELECT guild_id, user_id, open FROM modmail_threads WHERE thread_id = ?').get(threadId) as { guild_id: string; user_id: string; open: number } | undefined;
    return r ? { guildId: r.guild_id, userId: r.user_id, open: r.open === 1 } : null;
  }

  /** False when it was already closed. */
  closeModmail(threadId: string): boolean {
    return Number(this.db.prepare('UPDATE modmail_threads SET open = 0 WHERE thread_id = ? AND open = 1').run(threadId).changes) === 1;
  }

  modmailCount(guildId: string, userId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM modmail_threads WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as { n: number }).n;
  }

  setModmailBlocked(guildId: string, userId: string, blocked: boolean): void {
    if (blocked) this.db.prepare('INSERT OR IGNORE INTO modmail_blocks (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
    else this.db.prepare('DELETE FROM modmail_blocks WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  }

  modmailBlocked(guildId: string, userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM modmail_blocks WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  }

  // ─── Applications ────────────────────────────────────────────────────────────────────────────────────────────────

  addApplication(a: { guildId: string; formId: string; userId: string; answers: { q: string; a: string }[] }, now: number): number {
    return Number(this.db.prepare('INSERT INTO applications (guild_id, form_id, user_id, answers, created_at) VALUES (?, ?, ?, ?, ?)').run(a.guildId, a.formId, a.userId, JSON.stringify(a.answers), now).lastInsertRowid);
  }

  application(id: number): { id: number; guildId: string; formId: string; userId: string; status: string; answers: { q: string; a: string }[] } | null {
    const r = this.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as { id: number; guild_id: string; form_id: string; user_id: string; status: string; answers: string } | undefined;
    return r ? { id: r.id, guildId: r.guild_id, formId: r.form_id, userId: r.user_id, status: r.status, answers: JSON.parse(r.answers) as { q: string; a: string }[] } : null;
  }

  /** The member's latest application for a form: pending, or when it was decided. */
  lastApplication(guildId: string, formId: string, userId: string): { status: string; decidedAt: number | null } | null {
    const r = this.db.prepare('SELECT status, decided_at FROM applications WHERE guild_id = ? AND form_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(guildId, formId, userId) as { status: string; decided_at: number | null } | undefined;
    return r ? { status: r.status, decidedAt: r.decided_at } : null;
  }

  /** Accept or deny once; false if someone already decided it. */
  decideApplication(id: number, status: 'accepted' | 'denied', by: string, now: number): boolean {
    return Number(this.db.prepare("UPDATE applications SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'").run(status, by, now, id).changes) === 1;
  }

  // ─── Economy ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A member's account, created with the starting balance the first time. */
  account(guildId: string, userId: string, starting: number): EconomyAccount {
    this.db.prepare('INSERT OR IGNORE INTO economy (guild_id, user_id, wallet) VALUES (?, ?, ?)').run(guildId, userId, starting);
    const r = this.db.prepare('SELECT * FROM economy WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as {
      wallet: number; bank: number; last_daily: number | null; streak: number; last_work: number | null; last_rob: number | null; last_chat: number | null;
    };
    return { wallet: r.wallet, bank: r.bank, lastDaily: r.last_daily, streak: r.streak, lastWork: r.last_work, lastRob: r.last_rob, lastChat: r.last_chat };
  }

  /** Adds (or with a negative amount takes) coins; false if the wallet would go below zero. */
  addCoins(guildId: string, userId: string, delta: number, starting: number): boolean {
    this.account(guildId, userId, starting);
    return Number(this.db.prepare('UPDATE economy SET wallet = wallet + ? WHERE guild_id = ? AND user_id = ? AND wallet + ? >= 0').run(delta, guildId, userId, delta).changes) === 1;
  }

  /** Moves coins between wallets in one step; false if the sender doesn't have enough. */
  transferCoins(guildId: string, from: string, to: string, amount: number, starting: number): boolean {
    if (amount <= 0 || from === to) return false;
    this.account(guildId, to, starting);
    if (!this.addCoins(guildId, from, -amount, starting)) return false;
    this.db.prepare('UPDATE economy SET wallet = wallet + ? WHERE guild_id = ? AND user_id = ?').run(amount, guildId, to);
    return true;
  }

  /** Wallet ⇄ bank; false if there isn't enough on the side it comes from. */
  moveToBank(guildId: string, userId: string, amount: number, deposit: boolean, starting: number): boolean {
    this.account(guildId, userId, starting);
    const sql = deposit
      ? 'UPDATE economy SET wallet = wallet - ?, bank = bank + ? WHERE guild_id = ? AND user_id = ? AND wallet >= ?'
      : 'UPDATE economy SET bank = bank - ?, wallet = wallet + ? WHERE guild_id = ? AND user_id = ? AND bank >= ?';
    return Number(this.db.prepare(sql).run(amount, amount, guildId, userId, amount).changes) === 1;
  }

  setEconomyTimes(guildId: string, userId: string, t: { lastDaily?: number; streak?: number; lastWork?: number; lastRob?: number; lastChat?: number }): void {
    const cols = { lastDaily: 'last_daily', streak: 'streak', lastWork: 'last_work', lastRob: 'last_rob', lastChat: 'last_chat' } as const;
    for (const [k, v] of Object.entries(t)) this.db.prepare(`UPDATE economy SET ${cols[k as keyof typeof cols]} = ? WHERE guild_id = ? AND user_id = ?`).run(v, guildId, userId);
  }

  /** Staff: set a wallet to an exact amount (bank stays). */
  setWallet(guildId: string, userId: string, wallet: number, starting: number): void {
    this.account(guildId, userId, starting);
    this.db.prepare('UPDATE economy SET wallet = ? WHERE guild_id = ? AND user_id = ?').run(wallet, guildId, userId);
  }

  richest(guildId: string, limit = 10): { userId: string; total: number }[] {
    return this.db.prepare('SELECT user_id AS userId, wallet + bank AS total FROM economy WHERE guild_id = ? ORDER BY total DESC LIMIT ?').all(guildId, limit) as { userId: string; total: number }[];
  }

  resetEconomy(guildId: string, userId: string | null): number {
    const r = userId ? this.db.prepare('DELETE FROM economy WHERE guild_id = ? AND user_id = ?').run(guildId, userId) : this.db.prepare('DELETE FROM economy WHERE guild_id = ?').run(guildId);
    if (userId) this.db.prepare('DELETE FROM economy_items WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
    else this.db.prepare('DELETE FROM economy_items WHERE guild_id = ?').run(guildId);
    return Number(r.changes);
  }

  addItem(guildId: string, userId: string, itemId: string): void {
    this.db.prepare('INSERT INTO economy_items (guild_id, user_id, item_id, count) VALUES (?, ?, ?, 1) ON CONFLICT (guild_id, user_id, item_id) DO UPDATE SET count = count + 1').run(guildId, userId, itemId);
  }

  items(guildId: string, userId: string): { itemId: string; count: number }[] {
    return this.db.prepare('SELECT item_id AS itemId, count FROM economy_items WHERE guild_id = ? AND user_id = ? ORDER BY item_id').all(guildId, userId) as { itemId: string; count: number }[];
  }

  // ─── Counting ────────────────────────────────────────────────────────────────────────────────────────────────────

  counting(guildId: string): { count: number; lastUserId: string | null; record: number } {
    const r = this.db.prepare('SELECT count, last_user_id, record FROM counting WHERE guild_id = ?').get(guildId) as { count: number; last_user_id: string | null; record: number } | undefined;
    return r ? { count: r.count, lastUserId: r.last_user_id, record: r.record } : { count: 0, lastUserId: null, record: 0 };
  }

  /** Saves a good count (and the record), or a reset when `count` is 0. */
  setCounting(guildId: string, count: number, lastUserId: string | null): void {
    this.db
      .prepare('INSERT INTO counting (guild_id, count, last_user_id, record) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id) DO UPDATE SET count = excluded.count, last_user_id = excluded.last_user_id, record = MAX(record, excluded.count)')
      .run(guildId, count, lastUserId, count);
    if (lastUserId && count > 0) {
      this.db.prepare('INSERT INTO counting_users (guild_id, user_id, n) VALUES (?, ?, 1) ON CONFLICT (guild_id, user_id) DO UPDATE SET n = n + 1').run(guildId, lastUserId);
    }
  }

  topCounters(guildId: string, limit = 5): { userId: string; n: number }[] {
    return this.db.prepare('SELECT user_id AS userId, n FROM counting_users WHERE guild_id = ? ORDER BY n DESC LIMIT ?').all(guildId, limit) as { userId: string; n: number }[];
  }

  // ─── Reminders (list / cancel) ───────────────────────────────────────────────────────────────────────────────────

  remindersOf(guildId: string, userId: string): { id: number; text: string; dueAt: number }[] {
    return (this.db.prepare('SELECT id, text, due_at FROM reminders WHERE guild_id = ? AND user_id = ? ORDER BY due_at LIMIT 25').all(guildId, userId) as { id: number; text: string; due_at: number }[]).map((r) => ({ id: r.id, text: r.text, dueAt: r.due_at }));
  }

  cancelReminder(id: number, userId: string): boolean {
    return Number(this.db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, userId).changes) === 1;
  }

  // ─── Ticket blacklist ────────────────────────────────────────────────────────────────────────────────────────────

  setTicketBlacklisted(guildId: string, userId: string, on: boolean): void {
    if (on) this.db.prepare('INSERT OR IGNORE INTO ticket_blacklist (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
    else this.db.prepare('DELETE FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  }

  ticketBlacklisted(guildId: string, userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  }

  openTicketCount(guildId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND closed_at IS NULL').get(guildId) as { n: number }).n;
  }

  openModmails(guildId: string): { threadId: string; userId: string }[] {
    return (this.db.prepare('SELECT thread_id, user_id FROM modmail_threads WHERE guild_id = ? AND open = 1').all(guildId) as { thread_id: string; user_id: string }[]).map((r) => ({ threadId: r.thread_id, userId: r.user_id }));
  }

  // ─── Economy (round 2) ───────────────────────────────────────────────────────────────────────────────────────────

  lastBegCrime(guildId: string, userId: string): { beg: number | null; crime: number | null } {
    const r = this.db.prepare('SELECT last_beg, last_crime FROM economy WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as { last_beg: number | null; last_crime: number | null } | undefined;
    return { beg: r?.last_beg ?? null, crime: r?.last_crime ?? null };
  }

  setBegCrime(guildId: string, userId: string, which: 'beg' | 'crime', at: number): void {
    this.db.prepare(`UPDATE economy SET ${which === 'beg' ? 'last_beg' : 'last_crime'} = ? WHERE guild_id = ? AND user_id = ?`).run(at, guildId, userId);
  }

  /** Adds `percent`% interest to every bank balance in a server (rounded down). */
  applyInterest(guildId: string, percent: number): number {
    return Number(this.db.prepare('UPDATE economy SET bank = bank + CAST(bank * ? / 100 AS INTEGER) WHERE guild_id = ? AND bank > 0').run(percent, guildId).changes);
  }

  // ─── Confessions ─────────────────────────────────────────────────────────────────────────────────────────────────

  addConfession(guildId: string, userId: string, text: string, image: string | null, status: 'pending' | 'posted', now: number): { id: number; number: number | null } {
    const number = status === 'posted' ? this.nextConfessionNumber(guildId) : null;
    const id = Number(this.db.prepare('INSERT INTO confessions (guild_id, user_id, text, image, status, number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(guildId, userId, text, image, status, number, now).lastInsertRowid);
    return { id, number };
  }

  private nextConfessionNumber(guildId: string): number {
    return (this.db.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM confessions WHERE guild_id = ?").get(guildId) as { n: number }).n;
  }

  confession(id: number): { id: number; guildId: string; userId: string; text: string; image: string | null; status: string; number: number | null } | null {
    const r = this.db.prepare('SELECT * FROM confessions WHERE id = ?').get(id) as { id: number; guild_id: string; user_id: string; text: string; image: string | null; status: string; number: number | null } | undefined;
    return r ? { id: r.id, guildId: r.guild_id, userId: r.user_id, text: r.text, image: r.image, status: r.status, number: r.number } : null;
  }

  /** Approve (gets the next number) or deny a waiting confession, once. */
  decideConfession(id: number, approve: boolean): number | null | false {
    const c = this.confession(id);
    if (!c || c.status !== 'pending') return false;
    const number = approve ? this.nextConfessionNumber(c.guildId) : null;
    this.db.prepare("UPDATE confessions SET status = ?, number = ? WHERE id = ? AND status = 'pending'").run(approve ? 'posted' : 'denied', number, id);
    return number;
  }

  lastConfessionAt(guildId: string, userId: string): number | null {
    return (this.db.prepare('SELECT MAX(created_at) AS at FROM confessions WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as { at: number | null }).at;
  }

  setConfessionBanned(guildId: string, userId: string, on: boolean): void {
    if (on) this.db.prepare('INSERT OR IGNORE INTO confession_bans (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
    else this.db.prepare('DELETE FROM confession_bans WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  }

  confessionBanned(guildId: string, userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM confession_bans WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  }

  // ─── Highlights ──────────────────────────────────────────────────────────────────────────────────────────────────

  highlightWords(guildId: string, userId: string): string[] {
    return (this.db.prepare('SELECT word FROM highlights WHERE guild_id = ? AND user_id = ? ORDER BY word').all(guildId, userId) as { word: string }[]).map((r) => r.word);
  }

  /** Everyone's words in a server: word → member IDs. */
  allHighlights(guildId: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const r of this.db.prepare('SELECT word, user_id FROM highlights WHERE guild_id = ?').all(guildId) as { word: string; user_id: string }[]) out.set(r.word, [...(out.get(r.word) ?? []), r.user_id]);
    return out;
  }

  addHighlight(guildId: string, userId: string, word: string): boolean {
    return Number(this.db.prepare('INSERT OR IGNORE INTO highlights (guild_id, user_id, word) VALUES (?, ?, ?)').run(guildId, userId, word).changes) === 1;
  }

  removeHighlight(guildId: string, userId: string, word: string | null): number {
    return Number(
      (word ? this.db.prepare('DELETE FROM highlights WHERE guild_id = ? AND user_id = ? AND word = ?').run(guildId, userId, word) : this.db.prepare('DELETE FROM highlights WHERE guild_id = ? AND user_id = ?').run(guildId, userId)).changes,
    );
  }

  /** Toggles ignoring a channel for a member's highlights; true when it's now ignored. */
  toggleHighlightIgnore(guildId: string, userId: string, channelId: string): boolean {
    if (Number(this.db.prepare('DELETE FROM highlight_ignores WHERE guild_id = ? AND user_id = ? AND channel_id = ?').run(guildId, userId, channelId).changes)) return false;
    this.db.prepare('INSERT INTO highlight_ignores (guild_id, user_id, channel_id) VALUES (?, ?, ?)').run(guildId, userId, channelId);
    return true;
  }

  highlightIgnored(guildId: string, userId: string, channelId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM highlight_ignores WHERE guild_id = ? AND user_id = ? AND channel_id = ?').get(guildId, userId, channelId);
  }

  // ─── Channel automation ──────────────────────────────────────────────────────────────────────────────────────────

  /** Records a post and says whether the member was still within the cooldown (true = too soon; nothing recorded). */
  tooSoonInChannel(channelId: string, userId: string, cooldownMs: number, now: number): boolean {
    const r = this.db.prepare('SELECT at FROM channel_posts WHERE channel_id = ? AND user_id = ?').get(channelId, userId) as { at: number } | undefined;
    if (r && now - r.at < cooldownMs) return true;
    this.db.prepare('INSERT OR REPLACE INTO channel_posts (channel_id, user_id, at) VALUES (?, ?, ?)').run(channelId, userId, now);
    return false;
  }

  // ─── Activity ────────────────────────────────────────────────────────────────────────────────────────────────────

  addActivity(guildId: string, userId: string, day: string, messages: number, voice: number): void {
    this.db
      .prepare('INSERT INTO activity_daily (guild_id, user_id, day, messages, voice) VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, user_id, day) DO UPDATE SET messages = messages + excluded.messages, voice = voice + excluded.voice')
      .run(guildId, userId, day, messages, voice);
  }

  /** A member's messages and voice minutes since `fromDay` (YYYY-MM-DD, '' = all time). */
  activityOf(guildId: string, userId: string, fromDay: string): { messages: number; voice: number } {
    const r = this.db.prepare('SELECT COALESCE(SUM(messages), 0) AS m, COALESCE(SUM(voice), 0) AS v FROM activity_daily WHERE guild_id = ? AND user_id = ? AND day >= ?').get(guildId, userId, fromDay) as { m: number; v: number };
    return { messages: r.m, voice: r.v };
  }

  topActivity(guildId: string, fromDay: string, by: 'messages' | 'voice', limit = 10): { userId: string; n: number }[] {
    return this.db.prepare(`SELECT user_id AS userId, SUM(${by}) AS n FROM activity_daily WHERE guild_id = ? AND day >= ? GROUP BY user_id HAVING n > 0 ORDER BY n DESC LIMIT ?`).all(guildId, fromDay, limit) as { userId: string; n: number }[];
  }

  serverActivity(guildId: string, fromDay: string): { day: string; messages: number; voice: number; members: number }[] {
    return this.db.prepare('SELECT day, SUM(messages) AS messages, SUM(voice) AS voice, COUNT(*) AS members FROM activity_daily WHERE guild_id = ? AND day >= ? GROUP BY day ORDER BY day').all(guildId, fromDay) as { day: string; messages: number; voice: number; members: number }[];
  }

  // ─── Reputation ──────────────────────────────────────────────────────────────────────────────────────────────────

  reps(guildId: string, userId: string): number {
    return (this.db.prepare('SELECT reps FROM reputation WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as { reps: number } | undefined)?.reps ?? 0;
  }

  /** Gives one rep if the giver is past their cooldown; returns the receiver's new total, or null when too soon. */
  giveRep(guildId: string, giverId: string, receiverId: string, cooldownMs: number, now: number): number | null {
    const g = this.db.prepare('SELECT given_at FROM reputation WHERE guild_id = ? AND user_id = ?').get(guildId, giverId) as { given_at: number | null } | undefined;
    if (g?.given_at != null && now - g.given_at < cooldownMs) return null;
    this.db.prepare('INSERT INTO reputation (guild_id, user_id, given_at) VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET given_at = excluded.given_at').run(guildId, giverId, now);
    this.db.prepare('INSERT INTO reputation (guild_id, user_id, reps) VALUES (?, ?, 1) ON CONFLICT (guild_id, user_id) DO UPDATE SET reps = reps + 1').run(guildId, receiverId);
    return this.reps(guildId, receiverId);
  }

  /** When the giver can give rep again (null = now). */
  repReadyAt(guildId: string, giverId: string, cooldownMs: number): number | null {
    const g = this.db.prepare('SELECT given_at FROM reputation WHERE guild_id = ? AND user_id = ?').get(guildId, giverId) as { given_at: number | null } | undefined;
    return g?.given_at != null ? g.given_at + cooldownMs : null;
  }

  setReps(guildId: string, userId: string, reps: number): void {
    this.db.prepare('INSERT INTO reputation (guild_id, user_id, reps) VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET reps = excluded.reps').run(guildId, userId, reps);
  }

  topReps(guildId: string, limit = 10): { userId: string; reps: number }[] {
    return this.db.prepare('SELECT user_id AS userId, reps FROM reputation WHERE guild_id = ? AND reps > 0 ORDER BY reps DESC LIMIT ?').all(guildId, limit) as { userId: string; reps: number }[];
  }

  // ─── Member snapshots (sticky roles, welcome back) ───────────────────────────────────────────────────────────────

  saveSnapshot(guildId: string, userId: string, roles: string[], nick: string | null, now: number): void {
    this.db.prepare('INSERT OR REPLACE INTO member_snapshots (guild_id, user_id, roles, nick, left_at) VALUES (?, ?, ?, ?, ?)').run(guildId, userId, JSON.stringify(roles), nick, now);
  }

  /** The snapshot from when they left, removed as it's taken. */
  takeSnapshot(guildId: string, userId: string): { roles: string[]; nick: string | null; leftAt: number } | null {
    const r = this.db.prepare('SELECT roles, nick, left_at FROM member_snapshots WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as { roles: string; nick: string | null; left_at: number } | undefined;
    if (!r) return null;
    this.db.prepare('DELETE FROM member_snapshots WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
    return { roles: JSON.parse(r.roles) as string[], nick: r.nick, leftAt: r.left_at };
  }

  // ─── Shop counters (discount code uses, announced sales, vouch numbers) ───────────────────────────────────────────

  shopCount(guildId: string, key: string): number {
    const r = this.db.prepare('SELECT n FROM shop_counters WHERE guild_id = ? AND key = ?').get(guildId, key) as { n: number } | undefined;
    return r?.n ?? 0;
  }

  /** Adds one and returns the new count (1 = the first time). */
  bumpShopCount(guildId: string, key: string): number {
    this.db.prepare('INSERT INTO shop_counters (guild_id, key, n) VALUES (?, ?, 1) ON CONFLICT (guild_id, key) DO UPDATE SET n = n + 1').run(guildId, key);
    return this.shopCount(guildId, key);
  }

  /** Takes back one (e.g. a reserved code use when the order didn't go through). */
  dropShopCount(guildId: string, key: string): void {
    this.db.prepare('UPDATE shop_counters SET n = MAX(n - 1, 0) WHERE guild_id = ? AND key = ?').run(guildId, key);
  }

  // ─── Scheduled posts (to delete the previous one) ────────────────────────────────────────────────────────────────

  lastScheduledPost(key: string): { channelId: string; messageId: string } | null {
    const r = this.db.prepare('SELECT channel_id, message_id FROM scheduled_posts WHERE post_key = ?').get(key) as { channel_id: string; message_id: string } | undefined;
    return r ? { channelId: r.channel_id, messageId: r.message_id } : null;
  }

  saveScheduledPost(key: string, channelId: string, messageId: string): void {
    this.db.prepare('INSERT OR REPLACE INTO scheduled_posts (post_key, channel_id, message_id) VALUES (?, ?, ?)').run(key, channelId, messageId);
  }

  // ─── Workflow variables ({var:name}, kept between runs) ─────────────────────────────────────────────────────────

  workflowVars(guildId: string): Record<string, string> {
    const rows = this.db.prepare('SELECT name, value FROM workflow_vars WHERE guild_id = ?').all(guildId) as { name: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.name, r.value]));
  }

  setWorkflowVar(guildId: string, name: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO workflow_vars (guild_id, name, value) VALUES (?, ?, ?)').run(guildId, name, value);
  }

  // ─── Channel locks (what /lock changed, so /unlock can put it back) ──────────────────────────────────────────────

  channelLock(channelId: string): { allow: bigint; deny: bigint } | null {
    const r = this.db.prepare('SELECT allow, deny FROM channel_locks WHERE channel_id = ?').get(channelId) as { allow: string; deny: string } | undefined;
    return r ? { allow: BigInt(r.allow), deny: BigInt(r.deny) } : null;
  }

  saveChannelLock(guildId: string, channelId: string, previous: { allow: bigint; deny: bigint }): void {
    this.db.prepare('INSERT OR REPLACE INTO channel_locks (channel_id, guild_id, allow, deny) VALUES (?, ?, ?, ?)').run(channelId, guildId, String(previous.allow), String(previous.deny));
  }

  /** Channels currently locked by /lock or /lockdown in a server. */
  channelLocks(guildId: string): string[] {
    return (this.db.prepare('SELECT channel_id FROM channel_locks WHERE guild_id = ?').all(guildId) as { channel_id: string }[]).map((r) => r.channel_id);
  }

  removeChannelLock(channelId: string): void {
    this.db.prepare('DELETE FROM channel_locks WHERE channel_id = ?').run(channelId);
  }

  // ─── Social alerts ───────────────────────────────────────────────────────────────────────────────────────────────

  /** Items already announced for a feed, or null if the feed was never checked (so the first check posts nothing). */
  seenFeedItems(guildId: string, feedKey: string): Set<string> | null {
    const rows = this.db.prepare('SELECT item_id FROM feed_seen WHERE guild_id = ? AND feed_key = ?').all(guildId, feedKey) as { item_id: string }[];
    return rows.length ? new Set(rows.map((r) => r.item_id)) : null;
  }

  markFeedItemsSeen(guildId: string, feedKey: string, itemIds: string[], at = Date.now()): void {
    // An empty feed still counts as "checked", so its first real post is announced.
    for (const id of itemIds.length ? itemIds : ['(checked)']) {
      this.db.prepare('INSERT OR IGNORE INTO feed_seen (guild_id, feed_key, item_id, seen_at) VALUES (?, ?, ?, ?)').run(guildId, feedKey, id, at);
    }
    // Keep the newest 300 per feed.
    this.db
      .prepare(
        `DELETE FROM feed_seen WHERE guild_id = ? AND feed_key = ? AND item_id NOT IN
         (SELECT item_id FROM feed_seen WHERE guild_id = ? AND feed_key = ? ORDER BY seen_at DESC LIMIT 300)`,
      )
      .run(guildId, feedKey, guildId, feedKey);
  }

  // ─── Temporary bans ──────────────────────────────────────────────────────────────────────────────────────────────

  addTempBan(guildId: string, userId: string, unbanAt: number): void {
    this.db.prepare('INSERT OR REPLACE INTO temp_bans (guild_id, user_id, unban_at) VALUES (?, ?, ?)').run(guildId, userId, unbanAt);
  }

  removeTempBan(guildId: string, userId: string): void {
    this.db.prepare('DELETE FROM temp_bans WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  }

  dueTempBans(now: number): { guildId: string; userId: string }[] {
    return (this.db.prepare('SELECT guild_id, user_id FROM temp_bans WHERE unban_at <= ?').all(now) as { guild_id: string; user_id: string }[]).map((r) => ({
      guildId: r.guild_id,
      userId: r.user_id,
    }));
  }

  // ─── Invite tracker ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Records who invited a member (a rejoin replaces the old record). Returns the inviter's count of members who stayed. */
  recordInviteJoin(guildId: string, userId: string, inviterId: string | null, code: string | null, at = Date.now()): number {
    this.db
      .prepare('INSERT OR REPLACE INTO invite_joins (guild_id, user_id, inviter_id, code, joined_at, left_at) VALUES (?, ?, ?, ?, ?, NULL)')
      .run(guildId, userId, inviterId, code, at);
    return inviterId ? this.inviteCounts(guildId, inviterId).stayed : 0;
  }

  recordInviteLeave(guildId: string, userId: string, at = Date.now()): void {
    this.db.prepare('UPDATE invite_joins SET left_at = ? WHERE guild_id = ? AND user_id = ? AND left_at IS NULL').run(at, guildId, userId);
  }

  inviteCounts(guildId: string, inviterId: string): { stayed: number; left: number } {
    const r = this.db
      .prepare('SELECT SUM(left_at IS NULL) AS stayed, SUM(left_at IS NOT NULL) AS left FROM invite_joins WHERE guild_id = ? AND inviter_id = ?')
      .get(guildId, inviterId) as { stayed: number | null; left: number | null };
    return { stayed: r.stayed ?? 0, left: r.left ?? 0 };
  }

  invitedBy(guildId: string, userId: string): { inviterId: string | null; code: string | null } | null {
    const r = this.db.prepare('SELECT inviter_id, code FROM invite_joins WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as
      | { inviter_id: string | null; code: string | null }
      | undefined;
    return r ? { inviterId: r.inviter_id, code: r.code } : null;
  }

  inviteLeaderboard(guildId: string, limit = 10): { inviterId: string; stayed: number; left: number }[] {
    const rows = this.db
      .prepare(
        `SELECT inviter_id, SUM(left_at IS NULL) AS stayed, SUM(left_at IS NOT NULL) AS left FROM invite_joins
         WHERE guild_id = ? AND inviter_id IS NOT NULL GROUP BY inviter_id ORDER BY stayed DESC, left ASC LIMIT ?`,
      )
      .all(guildId, limit) as { inviter_id: string; stayed: number; left: number }[];
    return rows.map((r) => ({ inviterId: r.inviter_id, stayed: r.stayed, left: r.left }));
  }

  // ─── Starboard ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** Members whose messages collected the most stars on the starboard. */
  starLeaderboard(guildId: string, limit = 10): { userId: string; stars: number; posts: number }[] {
    const rows = this.db
      .prepare('SELECT author_id, SUM(stars) AS stars, COUNT(*) AS posts FROM starboard WHERE guild_id = ? AND author_id IS NOT NULL GROUP BY author_id ORDER BY stars DESC LIMIT ?')
      .all(guildId, limit) as { author_id: string; stars: number; posts: number }[];
    return rows.map((r) => ({ userId: r.author_id, stars: r.stars, posts: r.posts }));
  }

  starPost(guildId: string, messageId: string): string | null {
    const r = this.db.prepare('SELECT star_message_id FROM starboard WHERE guild_id = ? AND message_id = ?').get(guildId, messageId) as { star_message_id: string } | undefined;
    return r?.star_message_id ?? null;
  }

  setStarPost(guildId: string, messageId: string, starMessageId: string | null, authorId: string | null = null, stars = 0): void {
    if (starMessageId) {
      this.db
        .prepare('INSERT OR REPLACE INTO starboard (guild_id, message_id, star_message_id, author_id, stars) VALUES (?, ?, ?, ?, ?)')
        .run(guildId, messageId, starMessageId, authorId, stars);
    } else this.db.prepare('DELETE FROM starboard WHERE guild_id = ? AND message_id = ?').run(guildId, messageId);
  }

  // ─── Temporary voice ─────────────────────────────────────────────────────────────────────────────────────────────

  addTempChannel(guildId: string, channelId: string, ownerId: string): void {
    this.db.prepare('INSERT OR REPLACE INTO temp_channels (channel_id, guild_id, owner_id) VALUES (?, ?, ?)').run(channelId, guildId, ownerId);
  }

  isTempChannel(channelId: string): boolean {
    return this.db.prepare('SELECT 1 FROM temp_channels WHERE channel_id = ?').get(channelId) !== undefined;
  }

  tempChannels(guildId: string): string[] {
    return (this.db.prepare('SELECT channel_id FROM temp_channels WHERE guild_id = ?').all(guildId) as { channel_id: string }[]).map((r) => r.channel_id);
  }

  tempChannelOwner(channelId: string): string | null {
    const r = this.db.prepare('SELECT owner_id FROM temp_channels WHERE channel_id = ?').get(channelId) as { owner_id: string } | undefined;
    return r?.owner_id ?? null;
  }

  setTempChannelOwner(channelId: string, ownerId: string): void {
    this.db.prepare('UPDATE temp_channels SET owner_id = ? WHERE channel_id = ?').run(ownerId, channelId);
  }

  /** The temporary channel a member owns in a server, if any. */
  tempChannelOf(guildId: string, ownerId: string): string | null {
    const r = this.db.prepare('SELECT channel_id FROM temp_channels WHERE guild_id = ? AND owner_id = ?').get(guildId, ownerId) as { channel_id: string } | undefined;
    return r?.channel_id ?? null;
  }

  removeTempChannel(channelId: string): void {
    this.db.prepare('DELETE FROM temp_channels WHERE channel_id = ?').run(channelId);
  }

  // ─── Birthdays ───────────────────────────────────────────────────────────────────────────────────────────────────

  setBirthday(guildId: string, userId: string, month: number, day: number): void {
    // Changing the date resets "announced this year", so a corrected date still gets celebrated.
    this.db.prepare('INSERT OR REPLACE INTO birthdays (guild_id, user_id, month, day, announced_year) VALUES (?, ?, ?, ?, NULL)').run(guildId, userId, month, day);
  }

  removeBirthday(guildId: string, userId: string): boolean {
    return Number(this.db.prepare('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes) > 0;
  }

  birthdays(guildId: string): { userId: string; month: number; day: number; announcedYear: number | null }[] {
    const rows = this.db.prepare('SELECT user_id, month, day, announced_year FROM birthdays WHERE guild_id = ?').all(guildId) as {
      user_id: string;
      month: number;
      day: number;
      announced_year: number | null;
    }[];
    return rows.map((r) => ({ userId: r.user_id, month: r.month, day: r.day, announcedYear: r.announced_year }));
  }

  markBirthdayAnnounced(guildId: string, userId: string, year: number): void {
    this.db.prepare('UPDATE birthdays SET announced_year = ? WHERE guild_id = ? AND user_id = ?').run(year, guildId, userId);
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
