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

  /** Resets one member's XP, or everyone's in the server when no member is given. Returns how many were reset. */
  resetXp(guildId: string, userId: string | null): number {
    return Number(
      (userId ? this.db.prepare('DELETE FROM xp WHERE guild_id = ? AND user_id = ?').run(guildId, userId) : this.db.prepare('DELETE FROM xp WHERE guild_id = ?').run(guildId)).changes,
    );
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

  starPost(guildId: string, messageId: string): string | null {
    const r = this.db.prepare('SELECT star_message_id FROM starboard WHERE guild_id = ? AND message_id = ?').get(guildId, messageId) as { star_message_id: string } | undefined;
    return r?.star_message_id ?? null;
  }

  setStarPost(guildId: string, messageId: string, starMessageId: string | null): void {
    if (starMessageId) this.db.prepare('INSERT OR REPLACE INTO starboard (guild_id, message_id, star_message_id) VALUES (?, ?, ?)').run(guildId, messageId, starMessageId);
    else this.db.prepare('DELETE FROM starboard WHERE guild_id = ? AND message_id = ?').run(guildId, messageId);
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
