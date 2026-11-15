import { describe, expect, it } from 'vitest';
import { AnalyticsRepository } from '../src/main/db/analytics';
import { openDatabase } from '../src/main/db/database';

const T = Date.parse('2026-11-15T12:00:00Z');

function setup() {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO bot_projects (id, name) VALUES ('b1', '=Evil bot')").run();
  return new AnalyticsRepository(db);
}

describe('AnalyticsRepository', () => {
  it('counts commands, errors, crashes and online time per day', () => {
    const a = setup();
    a.heartbeat('b1', T);
    a.heartbeat('b1', T + 15_000);
    a.heartbeat('b1', T + 30_000);
    a.heartbeat('b1', T + 30_000 + 5 * 60_000); // after a long gap: not counted as online
    a.command('b1', 'rank', true, 40, T);
    a.command('b1', 'rank', false, 60, T);
    a.crash('b1', T);
    const r = a.report(7, null, T);
    expect(r.daily).toHaveLength(7);
    expect(r.daily.at(-1)).toEqual({ day: '2026-11-15', onlineSeconds: 30, commands: 2, errors: 1, crashes: 1 });
    expect(r.daily[0]).toMatchObject({ day: '2026-11-09', commands: 0 });
    expect(r.topCommands).toEqual([{ name: 'rank', uses: 2, errors: 1, avgMs: 50 }]);
  });

  it('exports CSV that spreadsheet apps cannot run as a formula', () => {
    const a = setup();
    a.command('b1', 'x', true, 1, T);
    const csv = a.csv(7, () => '=Evil bot', T).split('\n');
    expect(csv[1]).toBe('2026-11-15,"\'=Evil bot",0.00,1,0,0');
  });
});
