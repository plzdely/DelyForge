import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, type IpcMainInvokeEvent, app, nativeTheme, session, shell } from 'electron';
import { BRAND, IPC_CHANNELS, type AppSettings } from '@delyforge/shared';
import { openDatabase } from './db/database';
import { ActivityRepository, DashboardRepository, SettingsRepository } from './db/repositories';
import { createIpcRegistrar } from './ipc';
import { Logger } from './logger';
import {
  APP_ORIGIN,
  applyDevCsp,
  denyAllPermissions,
  hardenApp,
  registerAppScheme,
  serveRenderer,
} from './security';

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];
const isDev = !app.isPackaged && Boolean(DEV_SERVER_URL);

// ─── Pre-ready setup ────────────────────────────────────────────────────────────────────────────────────────────────

app.setName(BRAND.productName);
// Allows tests to use an isolated profile instead of the real one.
if (process.env['DELYFORGE_USER_DATA']) app.setPath('userData', process.env['DELYFORGE_USER_DATA']);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAppScheme();
  void main();
}

function isTrustedUrl(url: string): boolean {
  if (isDev && DEV_SERVER_URL) return url.startsWith(DEV_SERVER_URL);
  return url.startsWith(`${APP_ORIGIN}/`);
}

const TITLEBAR = {
  dark: { color: '#0c0c12', symbolColor: '#a1a1b5' },
  light: { color: '#f5f5f9', symbolColor: '#4b4b5c' },
} as const;

// ─── Main ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await app.whenReady();

  const userData = app.getPath('userData');
  const logger = new Logger(join(userData, 'logs'));
  logger.info('DelyForge starting', { version: app.getVersion(), electron: process.versions.electron });

  process.on('uncaughtException', (err) => logger.error('Uncaught exception', err));
  process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', err));

  // Local data
  const dataDir = join(userData, 'data');
  const db = openDatabase(join(dataDir, 'delyforge.db'));
  const settings = new SettingsRepository(db);
  const activity = new ActivityRepository(db);
  // Phase 3 replaces this with the bot supervisor's live count.
  const dashboard = new DashboardRepository(db, activity, () => 0);

  if (activity.count() === 0) activity.record('app', 'Welcome to DelyForge — your workspace is ready.');

  // Security
  const ses = session.defaultSession;
  denyAllPermissions(ses);
  hardenApp(isTrustedUrl);
  if (isDev) applyDevCsp(ses);
  else serveRenderer(ses, join(import.meta.dirname, '../renderer'));

  // Theme
  const applyTheme = (s: AppSettings) => {
    nativeTheme.themeSource = s.theme;
  };
  applyTheme(settings.get());

  // IPC
  const isTrustedSender = (event: IpcMainInvokeEvent) => isTrustedUrl(event.senderFrame?.url ?? '');
  const handle = createIpcRegistrar({ logger, isTrustedSender });

  handle(IPC_CHANNELS.appGetInfo, () => ({
    name: BRAND.productName,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    dataDirectory: dataDir,
  }));
  handle(IPC_CHANNELS.settingsGet, () => settings.get());
  handle(IPC_CHANNELS.settingsUpdate, (patch) => {
    const next = settings.update(patch);
    applyTheme(next);
    return next;
  });
  handle(IPC_CHANNELS.dashboardGetSummary, () => dashboard.summary());
  handle(IPC_CHANNELS.shellOpenExternal, async (url) => {
    await shell.openExternal(url);
    return null;
  });

  const win = createMainWindow();
  nativeTheme.on('updated', () => {
    const palette = nativeTheme.shouldUseDarkColors ? TITLEBAR.dark : TITLEBAR.light;
    if (!win.isDestroyed() && process.platform !== 'darwin') win.setTitleBarOverlay({ ...palette, height: 40 });
  });

  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', () => {
    try {
      db.close();
    } catch {
      // already closed
    }
  });

  if (process.env['DELYFORGE_SMOKE_DIR']) void runSmokeTest(win, process.env['DELYFORGE_SMOKE_DIR'], logger);
}

function createMainWindow(): BrowserWindow {
  const palette = nativeTheme.shouldUseDarkColors ? TITLEBAR.dark : TITLEBAR.light;
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: BRAND.productName,
    backgroundColor: palette.color,
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: { ...palette, height: 40 } } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    if (!process.env['DELYFORGE_SMOKE_DIR']) win.show();
  });

  if (isDev && DEV_SERVER_URL) void win.loadURL(DEV_SERVER_URL);
  else void win.loadURL(`${APP_ORIGIN}/index.html`);

  return win;
}

/**
 * Automated desktop smoke test: loads each main screen in a hidden window, checks the UI rendered without errors,
 * saves a screenshot of each, then exits with code 0 (pass) or 1 (fail). Used by `pnpm test:smoke`.
 */
async function runSmokeTest(win: BrowserWindow, outDir: string, logger: Logger): Promise<void> {
  const routes = ['/', '/settings', '/subscription'];
  mkdirSync(outDir, { recursive: true });
  const failures: string[] = [];
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') failures.push(`console error: ${details.message}`);
  });

  const waitForReady = async (route: string) => {
    for (let i = 0; i < 50; i++) {
      const ready = (await win.webContents.executeJavaScript(
        `document.querySelector('[data-route-ready="${route}"]') !== null`,
      )) as boolean;
      if (ready) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };

  const settle = () => new Promise((r) => setTimeout(r, 500)); // let animations & paint settle
  const capture = async (name: string) => {
    const image = await win.webContents.capturePage();
    writeFileSync(join(outDir, `${name}.png`), image.toPNG());
  };
  const loaded = () =>
    new Promise<void>((resolve) => {
      if (!win.webContents.isLoading()) resolve();
      else win.webContents.once('did-finish-load', () => resolve());
    });

  try {
    // Hidden windows are not repainted by Chromium, so show it (without stealing focus) to get real screenshots.
    win.showInactive();
    await loaded();
    for (const route of routes) {
      await win.webContents.executeJavaScript(`window.location.hash = '#${route}'`);
      if (!(await waitForReady(route))) failures.push(`route ${route} did not render`);
      await settle();
      await capture(route === '/' ? 'dashboard' : route.slice(1));
    }

    // End-to-end settings check: UI bridge → IPC validation → SQLite → survives a reload.
    const saved = (await win.webContents.executeJavaScript(
      `window.delyforge.settings.update({ theme: 'light' }).then((r) => r.ok && r.data.theme)`,
    )) as string | false;
    if (saved !== 'light') failures.push('settings update via IPC failed');
    const rejected = (await win.webContents.executeJavaScript(
      `window.delyforge.settings.update({ theme: 'neon' }).then((r) => !r.ok && r.error.code)`,
    )) as string | false;
    if (rejected !== 'VALIDATION_FAILED') failures.push('invalid settings payload was not rejected');

    await win.webContents.executeJavaScript(`window.location.hash = '#/'`);
    win.webContents.reload();
    await new Promise((r) => setTimeout(r, 300));
    await loaded();
    if (!(await waitForReady('/'))) failures.push('dashboard did not render after reload');
    const theme = (await win.webContents.executeJavaScript('document.documentElement.dataset.theme')) as string;
    if (theme !== 'light') failures.push(`theme did not persist across reload (got ${theme})`);
    await settle();
    await capture('dashboard-light');
  } catch (err) {
    failures.push(`smoke test crashed: ${(err as Error).message}`);
  }

  if (failures.length) logger.error('Smoke test failed', failures);
  else logger.info('Smoke test passed');
  writeFileSync(join(outDir, 'result.json'), JSON.stringify({ ok: failures.length === 0, failures }, null, 2));
  app.exit(failures.length === 0 ? 0 : 1);
}
