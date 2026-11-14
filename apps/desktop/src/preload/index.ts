import { contextBridge, ipcRenderer } from 'electron';
import { type DelyForgeBridge, IPC_CHANNELS } from '@delyforge/shared';

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
};

contextBridge.exposeInMainWorld('delyforge', Object.freeze(bridge));
