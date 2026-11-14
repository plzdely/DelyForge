/**
 * Local database migrations. Append new migrations to the end — NEVER edit or reorder a released migration,
 * because customers' databases have already applied it. `PRAGMA user_version` stores how many have run.
 */
export const MIGRATIONS: readonly string[] = [
  // 1 — Phase 1 foundation
  `
  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE bot_projects (
    id                     TEXT PRIMARY KEY,
    name                   TEXT NOT NULL,
    description            TEXT NOT NULL DEFAULT '',
    avatar_path            TEXT,
    discord_application_id TEXT,
    group_name             TEXT,
    config                 TEXT NOT NULL DEFAULT '{}',
    is_favorite            INTEGER NOT NULL DEFAULT 0,
    is_enabled             INTEGER NOT NULL DEFAULT 1,
    auto_start             INTEGER NOT NULL DEFAULT 0,
    auto_restart           INTEGER NOT NULL DEFAULT 1,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Bot tokens live in their own table, encrypted with the OS keystore (safeStorage / DPAPI).
  -- Exports and backups exclude this table by default. See SECURITY.md S1.
  CREATE TABLE bot_secrets (
    bot_id          TEXT PRIMARY KEY REFERENCES bot_projects(id) ON DELETE CASCADE,
    encrypted_token BLOB NOT NULL,
    token_hint      TEXT,
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    message    TEXT NOT NULL,
    bot_id     TEXT REFERENCES bot_projects(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX activity_created_idx ON activity (created_at DESC);
  `,
];
