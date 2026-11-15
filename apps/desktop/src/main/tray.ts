import { type BrowserWindow, Menu, Notification, Tray, app, nativeImage } from 'electron';
import iconPath from '../../build/icon.png?asset';

/**
 * Keeps DelyForge (and its bots) running when the window is closed: the window hides into the tray by the clock, and
 * "Quit DelyForge" in the tray menu really stops everything. With the setting off, closing the window quits as before.
 */
export function setupTray(opts: {
  win: BrowserWindow;
  runInBackground: () => boolean;
  startAll: () => void;
  stopAll: () => void;
  onlineCount: () => number;
}) {
  const { win } = opts;
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });

  const show = () => {
    if (win.isDestroyed()) return;
    win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
  };

  const tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip('DelyForge');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open DelyForge', click: show },
      { type: 'separator' },
      { label: 'Start all bots', click: opts.startAll },
      { label: 'Stop all bots', click: opts.stopAll },
      { type: 'separator' },
      { label: 'Quit DelyForge', click: () => app.quit() },
    ]),
  );
  tray.on('click', show);
  const tooltip = () => {
    const n = opts.onlineCount();
    tray.setToolTip(`DelyForge — ${n} bot${n === 1 ? '' : 's'} online`);
  };
  tooltip();
  setInterval(tooltip, 10_000).unref();

  let told = false;
  win.on('close', (event) => {
    if (quitting || !opts.runInBackground()) return;
    event.preventDefault();
    win.hide();
    if (!told && Notification.isSupported()) {
      told = true;
      new Notification({ title: 'DelyForge is still running', body: 'Your bots stay online. Click the DelyForge icon by the clock to open it, or right-click it to quit.' }).show();
    }
  });

  return { show };
}
