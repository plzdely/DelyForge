import { type IpcRendererEvent, contextBridge, ipcRenderer } from 'electron';
import { BOT_EVENT_CHANNEL, type BotEvent, type DelyForgeBridge, IPC_CHANNELS } from '@delyforge/shared';

/**
 * The ONLY bridge between the UI and the trusted main process.
 * Exposes a small, typed, frozen API — never raw `ipcRenderer` (ARCHITECTURE.md §4).
 */
const invoke = (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload);

const bridge: DelyForgeBridge = {
  app: {
    getInfo: () => invoke(IPC_CHANNELS.appGetInfo),
  },
  settings: {
    get: () => invoke(IPC_CHANNELS.settingsGet),
    update: (patch) => invoke(IPC_CHANNELS.settingsUpdate, patch),
  },
  dashboard: {
    getSummary: () => invoke(IPC_CHANNELS.dashboardGetSummary),
  },
  shell: {
    openExternal: (url) => invoke(IPC_CHANNELS.shellOpenExternal, url),
  },
  account: {
    getEntitlements: () => invoke(IPC_CHANNELS.accountGetEntitlements),
  },
  bots: {
    list: () => invoke(IPC_CHANNELS.botsList),
    get: (id) => invoke(IPC_CHANNELS.botsGet, { id }),
    create: (input) => invoke(IPC_CHANNELS.botsCreate, input),
    update: (input) => invoke(IPC_CHANNELS.botsUpdate, input),
    duplicate: (id) => invoke(IPC_CHANNELS.botsDuplicate, { id }),
    remove: (id) => invoke(IPC_CHANNELS.botsDelete, { id }),
    exportToFile: (id) => invoke(IPC_CHANNELS.botsExport, { id }),
    importFromFile: () => invoke(IPC_CHANNELS.botsImport),
    connect: (id, token) => invoke(IPC_CHANNELS.botsConnect, { id, token }),
    disconnect: (id) => invoke(IPC_CHANNELS.botsDisconnect, { id }),
  },
  runtime: {
    states: () => invoke(IPC_CHANNELS.runtimeStates),
    start: (id) => invoke(IPC_CHANNELS.runtimeStart, { id }),
    stop: (id) => invoke(IPC_CHANNELS.runtimeStop, { id }),
    restart: (id) => invoke(IPC_CHANNELS.runtimeRestart, { id }),
    startAll: () => invoke(IPC_CHANNELS.runtimeStartAll),
    stopAll: () => invoke(IPC_CHANNELS.runtimeStopAll),
  },
  logs: {
    list: (id, limit) => invoke(IPC_CHANNELS.logsList, limit === undefined ? { id } : { id, limit }),
    clear: (id) => invoke(IPC_CHANNELS.logsClear, { id }),
    exportToFile: (id) => invoke(IPC_CHANNELS.logsExport, { id }),
  },
  notifications: {
    list: () => invoke(IPC_CHANNELS.notificationsList),
    markRead: (ids) => invoke(IPC_CHANNELS.notificationsMarkRead, ids === undefined ? {} : { ids }),
    clear: () => invoke(IPC_CHANNELS.notificationsClear),
  },
  clipboard: {
    writeText: (text) => invoke(IPC_CHANNELS.clipboardWrite, text),
  },
  events: {
    onBotEvent: (listener) => {
      const wrapped = (_e: IpcRendererEvent, event: BotEvent) => listener(event);
      ipcRenderer.on(BOT_EVENT_CHANNEL, wrapped);
      return () => {
        ipcRenderer.removeListener(BOT_EVENT_CHANNEL, wrapped);
      };
    },
  },
};

contextBridge.exposeInMainWorld('delyforge', Object.freeze(bridge));
