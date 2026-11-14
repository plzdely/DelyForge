import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@delyforge/shared';
import { getSchemaVersion, migrate, openDatabase } from '../src/main/db/database';
import { MIGRATIONS } from '../src/main/db/migrations';
import { ActivityRepository, DashboardRepository, SettingsRepository } from '../src/main/db/repositories';

describe('local database', () => {
  it('applies all migrations on a fresh database', () => {
    const db = openDatabase(':memory:');
    expect(getSchemaVersion(db)).toBe(MIGRATIONS.length);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (t) => t.name,
    );
    expect(tables).toEqual(expect.arrayContaining(['settings', 'bot_projects', 'bot_secrets', 'activity']));
  });

  it('is idempotent when migrations are re-run', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toBe(MIGRATIONS.length);
  });

  it('rolls back a failing migration and reports it', () => {
    const db = openDatabase(':memory:');
    const broken = [...MIGRATIONS, 'CREATE TABLE ok_table (id INTEGER); THIS IS NOT SQL;'];
    expect(() => migrate(db, broken)).toThrow(/migration 2 failed/);
    expect(getSchemaVersion(db)).toBe(MIGRATIONS.length);
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE name='ok_table'").get();
    expect(exists).toBeUndefined();
  });

  it('refuses to open a database from a newer app version', () => {
    const db = openDatabase(':memory:');
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 5}`);
    expect(() => migrate(db)).toThrow(/Please update DelyForge/);
  });

  it('enforces foreign keys (secrets are deleted with their bot)', () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO bot_projects (id, name) VALUES ('b1', 'Helper')").run();
    db.prepare("INSERT INTO bot_secrets (bot_id, encrypted_token) VALUES ('b1', x'00')").run();
    db.prepare("DELETE FROM bot_projects WHERE id = 'b1'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM bot_secrets').get()).toEqual({ n: 0 });
  });
});

describe('SettingsRepository', () => {
  it('returns defaults on a fresh install', () => {
    const repo = new SettingsRepository(openDatabase(':memory:'));
    expect(repo.get()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('persists partial updates', () => {
    const db = openDatabase(':memory:');
    const repo = new SettingsRepository(db);
    repo.update({ theme: 'light' });
    repo.update({ reduceMotion: true });
    expect(new SettingsRepository(db).get()).toEqual({ ...DEFAULT_APP_SETTINGS, theme: 'light', reduceMotion: true });
  });

  it('ignores a corrupted stored value without resetting other settings', () => {
    const db = openDatabase(':memory:');
    const repo = new SettingsRepository(db);
    repo.update({ reduceMotion: true });
    db.prepare("INSERT INTO settings (key, value) VALUES ('theme', '\"neon\"')").run();
    expect(repo.get()).toEqual({ ...DEFAULT_APP_SETTINGS, reduceMotion: true });
  });
});

describe('DashboardRepository', () => {
  it('reports real counts and recent activity', () => {
    const db = openDatabase(':memory:');
    const activity = new ActivityRepository(db);
    const dash = new DashboardRepository(db, activity, () => 1);

    expect(dash.summary()).toMatchObject({ totalProjects: 0, onlineBots: 0, offlineBots: 0, recentActivity: [] });

    db.prepare("INSERT INTO bot_projects (id, name) VALUES ('a', 'A'), ('b', 'B')").run();
    activity.record('app', 'first');
    activity.record('bot', 'second');

    const s = dash.summary();
    expect(s.totalProjects).toBe(2);
    expect(s.onlineBots).toBe(1);
    expect(s.offlineBots).toBe(1);
    expect(s.recentActivity.map((a) => a.message)).toEqual(['second', 'first']);
  });
});
