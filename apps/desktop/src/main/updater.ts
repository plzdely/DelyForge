import type { UpdateStatus } from '@delyforge/shared';
import electronUpdater from 'electron-updater';
import type { Logger } from './logger';

const CHECK_EVERY_MS = 6 * 60 * 60_000;

/**
 * Automatic updates for installed copies. New versions come from the project's GitHub Releases page (free), or from
 * the update address baked into a commercial build. Updates download in the background over HTTPS; nothing is
 * installed until the person clicks "Restart to update". When the app is code-signed, electron-updater also checks
 * that the new installer is signed by the same publisher before running it.
 */
export function createUpdater(opts: { enabled: boolean; url: string; logger: Logger; onReady: (version: string) => void }) {
  let status: UpdateStatus = opts.enabled ? { state: 'idle' } : { state: 'disabled' };
  if (!opts.enabled) {
    return { status: () => status, check: async () => status, install: () => undefined };
  }
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
