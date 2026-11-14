import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

/**
 * Local SQLite database, owned exclusively by the main process.
 * Uses Node's built-in `node:sqlite` (bundled with Electron) — no native add-on to compile or ship.
 * All queries use prepared statements with bound parameters (no SQL string building — SECURITY.md S9).
 */
export type LocalDatabase = DatabaseSync;

export function openDatabase(path: string): LocalDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function getSchemaVersion(db: LocalDatabase): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

/** Applies pending migrations, each inside its own transaction. */
export function migrate(db: LocalDatabase, migrations: readonly string[] = MIGRATIONS): number {
  const current = getSchemaVersion(db);
  if (current > migrations.length) {
    throw new Error(
      `Local database is version ${current}, but this DelyForge build only knows ${migrations.length}. ` +
        'Please update DelyForge.',
    );
  }
  for (let v = current; v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`); // integer from our own loop, not user input
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Local database migration ${v + 1} failed: ${(err as Error).message}`);
    }
  }
  return getSchemaVersion(db);
}
