import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { UpdateStatus } from '@delyforge/shared';
import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { Logger } from './logger';

const CHECK_EVERY_MS = 6 * 60 * 60_000;
const LOCAL_CHECK_EVERY_MS = 5 * 60_000;

type Updater = { status(): UpdateStatus; check(): Promise<UpdateStatus>; install(): void };

/** True when `latest` (x.y.z) is a higher version than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** The version, installer file name and checksum from electron-builder's latest.yml. */
export function parseLatestYml(text: string): { version: string; path: string; sha512: string } | null {
  const version = /^version:\s*['"]?([\d.]+)['"]?\s*$/m.exec(text)?.[1];
  const path = /^path:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m.exec(text)?.[1];
  const sha512 = /^sha512:\s*['"]?([A-Za-z0-9+/=]+)['"]?\s*$/m.exec(text)?.[1];
  return version && path && sha512 && !path.includes('/') && !path.includes('\\') ? { version, path, sha512 } : null;
}

async function sha512Of(file: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('base64');
}

/**
 * Updates from the installer folder on this PC (Personal edition): when a newer installer is built, the app offers to
 * restart into it. The installer itself closes DelyForge, removes old copies and starts the new version.
 */
function localUpdater(dir: string, logger: Logger, onReady: (version: string) => void): Updater {
  let status: UpdateStatus = { state: 'idle' };
  let ready: { version: string; file: string } | null = null;
  let verified = ''; // "<file>@<mtime>" already checked, so a large installer isn't re-hashed every few minutes

  const check = async (): Promise<UpdateStatus> => {
    try {
      const latest = parseLatestYml(await readFile(join(dir, 'latest.yml'), 'utf8'));
      if (!latest || !isNewer(latest.version, app.getVersion())) return status;
      const file = join(dir, latest.path);
      const key = `${file}@${(await stat(file)).mtimeMs}`;
      if (ready?.version === latest.version && verified === key) return status;
      // Only offer an installer that is complete and matches its checksum (not one still being written).
      if ((await sha512Of(file)) !== latest.sha512) return status;
      verified = key;
      ready = { version: latest.version, file };
      status = { state: 'ready', version: latest.version };
      onReady(latest.version);
    } catch {
      // No installer built yet, or the folder moved: nothing to offer.
    }
    return status;
  };
  setTimeout(() => void check(), 30_000).unref();
  setInterval(() => void check(), LOCAL_CHECK_EVERY_MS).unref();

  return {
    status: () => status,
    check,
    install: () => {
      if (!ready) return;
      logger.info(`Installing DelyForge ${ready.version}`);
      // Start the installer a few seconds after we quit, so the bots can shut down cleanly first.
      const script = `Start-Sleep -Seconds 6; Start-Process -FilePath '${ready.file.replaceAll("'", "''")}' -ArgumentList '/S','--force-run'`;
      spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      app.quit();
    },
  };
}

/**
 * Automatic updates for installed copies, from (in this order) a commercial build's own update address, the installer
 * folder on this PC (Personal edition builds), or the project's GitHub Releases page. Nothing is installed until the
 * person clicks "Restart to update". When the app is code-signed, electron-updater also checks that the new installer
 * is signed by the same publisher before running it.
 */
export function createUpdater(opts: { enabled: boolean; url: string; localDir: string; logger: Logger; onReady: (version: string) => void }): Updater {
  let status: UpdateStatus = opts.enabled ? { state: 'idle' } : { state: 'disabled' };
  if (!opts.enabled) {
    return { status: () => status, check: async () => status, install: () => undefined };
  }
  if (!opts.url && opts.localDir) return localUpdater(opts.localDir, opts.logger, opts.onReady);

  const { autoUpdater } = electronUpdater;
  // Without a baked-in address, the installer's own app-update.yml (GitHub Releases, see electron-builder.yml) is used.
  if (opts.url) autoUpdater.setFeedURL({ provider: 'generic', url: opts.url });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // never install without the customer choosing to
  autoUpdater.on('checking-for-update', () => (status = { state: 'checking' }));
  autoUpdater.on('update-not-available', () => (status = { state: 'idle' }));
  autoUpdater.on('update-available', (info) => (status = { state: 'downloading', version: info.version }));
  autoUpdater.on('update-downloaded', (info) => {
    status = { state: 'ready', version: info.version };
    opts.onReady(info.version);
  });
  autoUpdater.on('error', (err) => {
    opts.logger.warn('Update check failed', err.message);
    status = { state: 'error', message: 'Couldn’t check for updates. DelyForge will try again later.' };
  });

  const check = async (): Promise<UpdateStatus> => {
    if (status.state === 'downloading' || status.state === 'ready') return status;
    await autoUpdater.checkForUpdates().catch(() => null); // reported through the 'error' event
    return status;
  };
  setTimeout(() => void check(), 30_000).unref();
  setInterval(() => void check(), CHECK_EVERY_MS).unref();

  return {
    status: () => status,
    check,
    install: () => {
      if (status.state === 'ready') autoUpdater.quitAndInstall(false, true);
    },
  };
}
