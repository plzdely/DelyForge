import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOT_EXPORT_FORMAT, BOT_EXPORT_VERSION, type BotProjectExport } from '@delyforge/shared';
import { describe, expect, it } from 'vitest';
import { BackupService } from '../src/main/backups';

const ID = '11111111-1111-4111-8111-111111111111';
const exported = (name: string): BotProjectExport =>
  ({ format: BOT_EXPORT_FORMAT, version: BOT_EXPORT_VERSION, exportedAt: '2026-11-15T00:00:00.000Z', appVersion: '0.1.0', project: { name, description: '', groupName: null, config: {} } });

async function setup(features: string[] = ['backups']) {
  const dir = await mkdtemp(join(tmpdir(), 'df-backups-'));
  let name = 'Before';
  const restored: unknown[] = [];
  const applied: string[] = [];
  const service = new BackupService(
    dir,
    {
      list: () => [{ id: ID }] as never,
      get: () => ({ id: ID }) as never,
      exportProject: () => exported(name),
      restoreSettings: (_id, project) => void restored.push(project),
    },
    () => ({ features: features as never }),
    '0.1.0',
    (id) => void applied.push(id),
  );
  return { dir, service, restored, applied, rename: (n: string) => (name = n) };
}

describe('BackupService', () => {
  it('is a paid feature', async () => {
    const { service } = await setup([]);
    await expect(service.run()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.runIfDue()).toBe(false);
  });

  it('backs up once a day and keeps the newest 14', async () => {
    const { dir, service } = await setup();
    const day = (n: number) => new Date(Date.UTC(2026, 10, n, 12));
    for (let n = 1; n <= 16; n++) await service.run(day(n));
    expect(await service.runIfDue(day(16))).toBe(false);
    expect(await service.runIfDue(day(17))).toBe(true);
    const files = (await readdir(dir)).sort();
    expect(files).toHaveLength(14);
    expect(files[0]).toBe('2026-11-04.json');
  });

  it('restores a bot to its backed-up settings and refuses unknown files', async () => {
    const { service, restored, applied, rename } = await setup();
    const { file } = await service.run(new Date(Date.UTC(2026, 10, 15)));
    rename('After');
    await service.restore(file, ID);
    expect(restored).toEqual([expect.objectContaining({ name: 'Before' })]);
    expect(applied).toEqual([ID]);
    await expect(service.restore('../secrets.json', ID)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await service.list())[0]?.bots).toEqual([{ id: ID, name: 'Before' }]);
  });
});
