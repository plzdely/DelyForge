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
    status: () => invoke(IPC_CHANNELS.accountStatus),
    register: (input) => invoke(IPC_CHANNELS.accountRegister, input),
    login: (input) => invoke(IPC_CHANNELS.accountLogin, input),
    logout: () => invoke(IPC_CHANNELS.accountLogout),
    refresh: () => invoke(IPC_CHANNELS.accountRefresh),
    forgotPassword: (email) => invoke(IPC_CHANNELS.accountForgotPassword, { email }),
    resendVerification: () => invoke(IPC_CHANNELS.accountResendVerification),
    updateProfile: (displayName) => invoke(IPC_CHANNELS.accountUpdateProfile, { displayName }),
    linkDiscord: () => invoke(IPC_CHANNELS.accountLinkDiscord),
  },
  updates: {
    status: () => invoke(IPC_CHANNELS.updatesStatus),
    check: () => invoke(IPC_CHANNELS.updatesCheck),
    install: () => invoke(IPC_CHANNELS.updatesInstall),
  },
  admin: {
    overview: () => invoke(IPC_CHANNELS.adminOverview),
    users: (q) => invoke(IPC_CHANNELS.adminUsers, { q }),
    audit: () => invoke(IPC_CHANNELS.adminAudit),
    setUserStatus: (input) => invoke(IPC_CHANNELS.adminUserStatus, input),
    grant: (input) => invoke(IPC_CHANNELS.adminGrant, input),
    revoke: (id) => invoke(IPC_CHANNELS.adminRevoke, { id }),
    setRole: (input) => invoke(IPC_CHANNELS.adminRole, input),
    setListingStatus: (input) => invoke(IPC_CHANNELS.adminListingStatus, input),
    setReviewHidden: (input) => invoke(IPC_CHANNELS.adminReviewHidden, input),
  },
  team: {
    info: () => invoke(IPC_CHANNELS.teamInfo),
    invite: (input) => invoke(IPC_CHANNELS.teamInvite, input),
    revokeInvite: (id) => invoke(IPC_CHANNELS.teamRevokeInvite, { id }),
    removeMember: (userId) => invoke(IPC_CHANNELS.teamRemoveMember, { userId }),
    myInvites: () => invoke(IPC_CHANNELS.teamMyInvites),
    accept: (id) => invoke(IPC_CHANNELS.teamAccept, { id }),
    switchTo: (workspaceId) => invoke(IPC_CHANNELS.teamSwitch, { workspaceId }),
  },
  backups: {
    list: () => invoke(IPC_CHANNELS.backupsList),
    run: () => invoke(IPC_CHANNELS.backupsRun),
    restore: (input) => invoke(IPC_CHANNELS.backupsRestore, input),
  },
  analytics: {
    report: (input) => invoke(IPC_CHANNELS.analyticsReport, input),
    exportCsv: () => invoke(IPC_CHANNELS.analyticsExport),
  },
  marketplace: {
    list: (filter) => invoke(IPC_CHANNELS.marketList, filter),
    detail: (slug) => invoke(IPC_CHANNELS.marketDetail, { slug }),
    install: (input) => invoke(IPC_CHANNELS.marketInstall, input),
    review: (input) => invoke(IPC_CHANNELS.marketReview, input),
    developer: () => invoke(IPC_CHANNELS.marketDeveloper),
    becomeDeveloper: (input) => invoke(IPC_CHANNELS.marketBecomeDeveloper, input),
    mine: () => invoke(IPC_CHANNELS.marketMine),
    submit: (input) => invoke(IPC_CHANNELS.marketSubmit, input),
    queue: () => invoke(IPC_CHANNELS.marketQueue),
    moderate: (input) => invoke(IPC_CHANNELS.marketModerate, input),
  },
  ai: {
    usage: () => invoke(IPC_CHANNELS.aiUsage),
    build: (input) => invoke(IPC_CHANNELS.aiBuild, input),
    apply: (proposalId) => invoke(IPC_CHANNELS.aiApply, { proposalId }),
    reject: (proposalId) => invoke(IPC_CHANNELS.aiReject, { proposalId }),
    troubleshoot: (input) => invoke(IPC_CHANNELS.aiTroubleshoot, input),
  },
  billing: {
    checkout: (input) => invoke(IPC_CHANNELS.billingCheckout, input),
    portal: () => invoke(IPC_CHANNELS.billingPortal),
    invoices: () => invoke(IPC_CHANNELS.billingInvoices),
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
  discord: {
    guilds: (id, refresh) => invoke(IPC_CHANNELS.discordGuilds, refresh === undefined ? { id } : { id, refresh }),
  },
  modules: {
    get: (id) => invoke(IPC_CHANNELS.modulesGet, { id }),
    update: (input) => invoke(IPC_CHANNELS.modulesUpdate, input),
  },
  builders: {
    get: (id) => invoke(IPC_CHANNELS.buildersGet, { id }),
    save: (id, builders) => invoke(IPC_CHANNELS.buildersSave, { id, builders }),
    workflowRuns: (id) => invoke(IPC_CHANNELS.workflowRuns, { id }),
  },
  templates: {
    apply: (input) => invoke(IPC_CHANNELS.templatesApply, input),
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
