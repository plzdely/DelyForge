import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type BackupInfo, type Entitlements, botProjectExportSchema, lowestPlanWithFeature } from '@delyforge/shared';
import { z } from 'zod';
import type { BotRepository } from './db/bots';
import { AppError } from './errors';

const KEEP = 14;
const FILE = /^\d{4}-\d{2}-\d{2}\.json$/;
const backupFileSchema = z.object({
  format: z.literal('delyforge-backup'),
  createdAt: z.string(),
  bots: z.array(z.object({ id: z.string(), export: botProjectExportSchema })),
});

/**
 * Automatic daily backups of every bot's settings (Pro feature). Uses the export format, so tokens are never
 * included. One file per day, the newest 14 kept, stored in the app's data folder on this computer.
 */
export class BackupService {
  constructor(
    private readonly dir: string,
    private readonly bots: Pick<BotRepository, 'list' | 'exportProject' | 'restoreSettings' | 'get'>,
    private readonly entitlements: () => Pick<Entitlements, 'features'>,
    private readonly appVersion: string,
    /** Pushes restored settings to a running bot. */
    private readonly applyToRunningBot: (botId: string) => void,
  ) {}

  private assertAllowed(): void {
    if (!this.entitlements().features.includes('backups')) {
      throw new AppError('FORBIDDEN', `Backups are available on the ${lowestPlanWithFeature('backups')?.name ?? 'Pro'} plan.`);
    }
  }

  /** Writes today's backup (replacing an earlier one from today) and removes old ones. */
  async run(now = new Date()): Promise<BackupInfo> {
    this.assertAllowed();
    await mkdir(this.dir, { recursive: true });
    const file = `${now.toISOString().slice(0, 10)}.json`;
    const bots = this.bots.list().map((b) => ({ id: b.id, export: this.bots.exportProject(b.id, this.appVersion, true) }));
    await writeFile(join(this.dir, file), JSON.stringify({ format: 'delyforge-backup', createdAt: now.toISOString(), bots }), 'utf8');
    for (const old of (await this.files()).slice(KEEP)) await rm(join(this.dir, old), { force: true });
    return { file, createdAt: now.toISOString(), bots: bots.map((b) => ({ id: b.id, name: b.export.project.name })) };
  }

  /** Runs once a day when the plan includes backups; failures are logged, never shown as errors. */
  async runIfDue(now = new Date()): Promise<boolean> {
    if (!this.entitlements().features.includes('backups')) return false;
    if ((await this.files())[0] === `${now.toISOString().slice(0, 10)}.json`) return false;
    await this.run(now);
    return true;
  }

  private async files(): Promise<string[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    return names.filter((n) => FILE.test(n)).sort().reverse();
  }

  private async read(file: string) {
    if (!FILE.test(file)) throw new AppError('VALIDATION_FAILED', 'That isn’t a DelyForge backup.');
    const parsed = backupFileSchema.safeParse(JSON.parse(await readFile(join(this.dir, file), 'utf8').catch(() => '{}')));
    if (!parsed.success) throw new AppError('NOT_FOUND', 'That backup is missing or damaged.');
    return parsed.data;
  }

  async list(): Promise<BackupInfo[]> {
    const out: BackupInfo[] = [];
    for (const file of await this.files()) {
      const b = await this.read(file).catch(() => null);
      if (b) out.push({ file, createdAt: b.createdAt, bots: b.bots.map((x) => ({ id: x.id, name: x.export.project.name })) });
    }
    return out;
  }

  /** Puts one bot's settings back to how they were in the backup. */
  async restore(file: string, botId: string): Promise<void> {
    this.assertAllowed();
    this.bots.get(botId);
    const entry = (await this.read(file)).bots.find((b) => b.id === botId);
    if (!entry) throw new AppError('NOT_FOUND', 'That bot isn’t in this backup.');
    this.bots.restoreSettings(botId, entry.export.project);
    this.applyToRunningBot(botId);
  }
}
