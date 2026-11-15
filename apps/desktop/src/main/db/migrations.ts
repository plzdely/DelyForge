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

  // 2 — Phase 3: Discord connection, runtime settings, logs, notifications
  `
  ALTER TABLE bot_projects ADD COLUMN bot_username TEXT;
  ALTER TABLE bot_projects ADD COLUMN bot_avatar_url TEXT;
  ALTER TABLE bot_projects ADD COLUMN application_flags INTEGER;
  ALTER TABLE bot_projects ADD COLUMN presence TEXT NOT NULL DEFAULT '{"status":"online","activity":null}';
  -- 274878286912 = PERMISSION_PRESETS.basic (view, send, threads, embeds, files, history, reactions, external emoji)
  ALTER TABLE bot_projects ADD COLUMN permissions TEXT NOT NULL DEFAULT '274878286912';
  ALTER TABLE bot_projects ADD COLUMN intents INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE bot_projects ADD COLUMN builtin_ping INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE bot_projects ADD COLUMN guild_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE bot_projects ADD COLUMN commands_executed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE bot_secrets ADD COLUMN application_id TEXT;

  CREATE TABLE bot_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id     TEXT NOT NULL REFERENCES bot_projects(id) ON DELETE CASCADE,
    level      TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX bot_logs_bot_idx ON bot_logs (bot_id, id DESC);

  CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    bot_id     TEXT REFERENCES bot_projects(id) ON DELETE SET NULL,
    read_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX notifications_created_idx ON notifications (created_at DESC);
  `,

  // 3 — Phase 5: automation run history
  `
  CREATE TABLE workflow_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id      TEXT NOT NULL REFERENCES bot_projects(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL,
    ok          INTEGER NOT NULL,
    steps       INTEGER NOT NULL,
    message     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX workflow_runs_bot_idx ON workflow_runs (bot_id, id DESC);
  `,

  // 4 — Phase 9: daily analytics (counts only)
  `
  CREATE TABLE bot_stats_daily (
    bot_id         TEXT NOT NULL REFERENCES bot_projects(id) ON DELETE CASCADE,
    day            TEXT NOT NULL,
    online_seconds INTEGER NOT NULL DEFAULT 0,
    commands       INTEGER NOT NULL DEFAULT 0,
    command_errors INTEGER NOT NULL DEFAULT 0,
    crashes        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bot_id, day)
  );
  CREATE TABLE command_stats_daily (
    bot_id   TEXT NOT NULL REFERENCES bot_projects(id) ON DELETE CASCADE,
    day      TEXT NOT NULL,
    name     TEXT NOT NULL,
    uses     INTEGER NOT NULL DEFAULT 0,
    errors   INTEGER NOT NULL DEFAULT 0,
    total_ms INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bot_id, day, name)
  );
  `,
];
