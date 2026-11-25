import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  Notification,
  app,
  clipboard,
  dialog,
  nativeTheme,
  safeStorage,
  session,
  shell,
} from 'electron';
import {
  BOT_EVENT_CHANNEL,
  BOT_LIMITS,
  BRAND,
  type BotEvent,
  isAllowedExternalUrl,
  ANALYTICS_DAYS,
  PERSONAL_EDITION,
  IPC_CHANNELS,
  lowestPlanWithFeature,
  type AppSettings,
  type AdminAuditEntry,
  type AdminOverview,
  type AdminUser,
  type PendingInvite,
  type TeamInfo,
  slugify,
} from '@delyforge/shared';
import { AccountService } from './account';
import { AiAssistant } from './ai-assistant';
import { waitForDiscordAnswer } from './discord-link';
import { createUpdater } from './updater';
import { setupTray } from './tray';
import { MembersService } from './members-service';
import { BackupService } from './backups';
import { AnalyticsRepository } from './db/analytics';
import { MarketplaceClient } from './marketplace';
import { BotRepository } from './db/bots';
import { openDatabase } from './db/database';
import { LogRepository, NotificationRepository } from './db/logs';
import { SecretRepository } from './db/secrets';
import { DiscordApi } from './discord-api';
import { BotConnections } from './runtime/connections';
import { createElectronLauncher, resolveRuntimeEntry } from './runtime/electron-launcher';
import { BuildersService } from './runtime/builders-service';
import { ModulesService } from './runtime/modules-service';
import { BotSupervisor } from './runtime/supervisor';
import { ActivityRepository, DashboardRepository, SettingsRepository } from './db/repositories';
import { createEntitlementsProvider } from './entitlements';
import { AppError } from './errors';
import { createIpcRegistrar } from './ipc';
import { Logger } from './logger';
import { runSmokeTest } from './smoke';
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
// Installed copies identify as the installer's app ID, so Windows ties notifications and shortcuts to DelyForge.
if (app.isPackaged && process.platform === 'win32') app.setAppUserModelId('com.plzdely.delyforge');
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
  const cipher = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain: string) => safeStorage.encryptString(plain),
    decrypt: (data: Buffer) => safeStorage.decryptString(data),
  };
  const devEntitlements = createEntitlementsProvider({
    isPackaged: app.isPackaged,
    devPlan: process.env['DELYFORGE_DEV_PLAN'],
    personal: PERSONAL_EDITION,
  });
  if (devEntitlements().source === 'dev-override') {
    logger.warn(`Development plan override active: ${devEntitlements().effectivePlanId}`);
  }
  // Installed copies only trust what was baked in at build time: an environment variable must never be able to point the
  // app at another server or signing key (that would let someone fake a paid plan). Development may override both.
  const fromEnv = (name: string) => (app.isPackaged ? undefined : process.env[name] || undefined);
  const publicKeyB64 = fromEnv('DELYFORGE_ENTITLEMENT_PUBLIC_KEY') ?? (__DELYFORGE_PUBLIC_KEY__ || undefined);
  const account = new AccountService(db, cipher, {
    apiUrl: fromEnv('DELYFORGE_API_URL') ?? (__DELYFORGE_API_URL__ || 'http://localhost:4000'),
    publicKeyPem: publicKeyB64 ? Buffer.from(publicKeyB64, 'base64').toString('utf8') : null,
    // Copies without a built-in key (development and `dist:unsigned` test builds — `dist` refuses to build without one)
    // fetch it from the API they talk to. Customer builds never do, so a fake server can't sign fake plans for them.
    allowKeyDiscovery: !app.isPackaged || !__DELYFORGE_PUBLIC_KEY__,
    // Customer builds (with a real server baked in) can't be used without an account that has Discord linked.
    requireAccount: !PERSONAL_EDITION && (app.isPackaged ? Boolean(__DELYFORGE_API_URL__) : process.env['DELYFORGE_REQUIRE_ACCOUNT'] === '1'),
    onChange: () => {
      emit({ type: 'account-updated' });
      onAccountChange();
    },
  });
  /** Set once the supervisor exists: stops all bots when access is lost (signed out, banned, Discord unlinked). */
  let onAccountChange = () => {};
  const assertAccess = () => {
    const a = account.accessState();
    if (!a.allowed) throw new AppError('FORBIDDEN', a.needs === 'discord' ? 'Connect your Discord account first (Account page).' : 'Sign in to DelyForge first.');
  };
  /** Server-certified plan, or the development override. */
  const entitlements = () => (devEntitlements().source === 'local' ? account.entitlements() : devEntitlements());
  const bots = new BotRepository(db, activity, entitlements);
  const secrets = new SecretRepository(db, cipher);
  const logs = new LogRepository(db);
  const analytics = new AnalyticsRepository(db);
  const notifications = new NotificationRepository(db);
  const connections = new BotConnections(bots, secrets, new DiscordApi(app.getVersion()), activity);

  if (activity.count() === 0) activity.record('app', 'Welcome to DelyForge — your workspace is ready.');
  const pruneLogs = () => {
    try {
      logs.pruneOlderThan(entitlements().limits.logRetentionDays);
    } catch (err) {
      logger.warn('Log pruning failed', err);
    }
  };
  pruneLogs();
  setInterval(pruneLogs, 60 * 60_000).unref();

  // Live events → every open window
  const emit = (event: BotEvent) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(BOT_EVENT_CHANNEL, event);
    }
  };

  const supervisor = new BotSupervisor({
    launcher: createElectronLauncher(resolveRuntimeEntry()),
    bots,
    secrets,
    logs,
    notifications,
    settings: () => settings.get(),
    entitlements,
    dataDir: join(dataDir, 'bots'),
    onWorkflowRun: (botId, run) => buildersService.recordRun(botId, run),
    analytics,
    emit,
    desktopNotify: (title, body) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body });
      n.on('click', () => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w) {
          if (w.isMinimized()) w.restore();
          w.focus();
        }
      });
      n.show();
    },
  });

  const modulesService = new ModulesService(
    bots,
    secrets,
    new DiscordApi(app.getVersion()),
    activity,
    entitlements,
    (botId) => supervisor.applyModules(botId),
  );

  const buildersService = new BuildersService(db, bots, activity, entitlements, {
    builders: (botId) => supervisor.applyBuilders(botId),
    modules: (botId) => supervisor.applyModules(botId),
  });

  const dashboard = new DashboardRepository(
    db,
    activity,
    () => supervisor.onlineCount(),
    () => entitlements().effectivePlanId,
    () => {
      const t = bots.totals();
      return { totalServers: t.servers, totalCommands: t.commands, unreadNotifications: notifications.unreadCount() };
    },
  );

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
    // Only the installed app registers itself (a development build would register the bare Electron runtime).
    if ('startWithWindows' in patch && app.isPackaged) app.setLoginItemSettings({ openAtLogin: next.startWithWindows, args: ['--hidden'] });
    return next;
  });
  handle(IPC_CHANNELS.dashboardGetSummary, () => dashboard.summary());
  handle(IPC_CHANNELS.shellOpenExternal, async (url) => {
    await shell.openExternal(url);
    return null;
  });
  handle(IPC_CHANNELS.clipboardWrite, (text) => {
    clipboard.writeText(text);
    return null;
  });
  handle(IPC_CHANNELS.accountGetEntitlements, () => entitlements());
  handle(IPC_CHANNELS.accountStatus, () => account.status());
  handle(IPC_CHANNELS.accountRegister, (input) => account.register(input));
  handle(IPC_CHANNELS.accountLogin, (input) => account.login(input));
  handle(IPC_CHANNELS.accountLogout, () => account.logout());
  let discordLinking = false;
  handle(IPC_CHANNELS.accountLinkDiscord, async () => {
    if (discordLinking) throw new AppError('CONFLICT', 'Discord is already open in your browser — finish there first.');
    discordLinking = true;
    try {
      // Listen first, so Discord's answer (sent to this computer) can't arrive before we're ready.
      const { ready, answer } = waitForDiscordAnswer();
      await ready;
      const url = await account.discordLinkUrl();
      if (!isAllowedExternalUrl(url)) throw new AppError('INTERNAL', 'Unexpected sign-in address from the server.');
      await shell.openExternal(url);
      const { code, state } = await answer;
      await account.authed('POST', '/v1/me/discord/complete', { code, state });
      return await account.refreshPlan();
    } finally {
      discordLinking = false;
    }
  });
  handle(IPC_CHANNELS.accountRefresh, () => account.refreshPlan());
  handle(IPC_CHANNELS.accountForgotPassword, async ({ email }) => {
    await account.forgotPassword(email);
    return null;
  });
  handle(IPC_CHANNELS.accountResendVerification, async () => {
    await account.resendVerification();
    return null;
  });
  handle(IPC_CHANNELS.accountUpdateProfile, ({ displayName }) => account.updateProfile(displayName));
  const openStripe = async (url: string) => {
    if (!isAllowedExternalUrl(url)) throw new AppError('INTERNAL', 'Unexpected billing address from the server.');
    await shell.openExternal(url);
    return null;
  };
  handle(IPC_CHANNELS.billingCheckout, async ({ planId, interval }) => openStripe(await account.checkoutUrl(planId, interval)));
  handle(IPC_CHANNELS.billingPortal, async () => openStripe(await account.portalUrl()));
  handle(IPC_CHANNELS.billingInvoices, () => account.invoices());
  // Keep the plan certificate fresh: now and every 6 hours.
  const refreshPlan = () => void account.refreshPlan().catch((e: Error) => logger.warn(`Plan refresh failed: ${e.message}`));
  refreshPlan();
  setInterval(refreshPlan, 6 * 3600_000).unref();

  // Bot projects
  handle(IPC_CHANNELS.botsList, () => bots.list());
  handle(IPC_CHANNELS.botsGet, ({ id }) => bots.get(id));
  handle(IPC_CHANNELS.botsCreate, (input) => bots.create(input));
  handle(IPC_CHANNELS.botsUpdate, (input) => {
    const updated = bots.update(input);
    if (input.patch.presence) supervisor.setPresence(input.id);
    return updated;
  });
  handle(IPC_CHANNELS.botsDuplicate, ({ id }) => bots.duplicate(id));
  handle(IPC_CHANNELS.botsDelete, async ({ id }) => {
    await supervisor.forget(id);
    bots.remove(id);
    return null;
  });
  handle(IPC_CHANNELS.botsExport, async ({ id }, event) => {
    const project = bots.get(id);
    const result = await saveDialog(event, {
      title: `Export “${project.name}”`,
      defaultPath: join(app.getPath('documents'), `${slugify(project.name)}.delyforge.json`),
      filters: [{ name: 'DelyForge bot project', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false, fileName: null };
    const data = bots.exportProject(id, app.getVersion());
    await writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8');
    return { saved: true, fileName: basename(result.filePath) };
  });
  handle(IPC_CHANNELS.botsImport, async (_input, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Import a bot project',
      properties: ['openFile' as const],
      filters: [{ name: 'DelyForge bot project', extensions: ['json'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const file = result.filePaths[0];
    if (result.canceled || !file) return { project: null };
    if ((await stat(file)).size > BOT_LIMITS.importMaxBytes) {
      throw new AppError('VALIDATION_FAILED', 'This file is too large to be a DelyForge bot export.');
    }
    return { project: bots.importProject(await readFile(file, 'utf8')) };
  });
  handle(IPC_CHANNELS.botsConnect, async ({ id, token }) => {
    if (supervisor.state(id).status !== 'offline') await supervisor.stop(id);
    return connections.connect(id, token);
  });
  handle(IPC_CHANNELS.botsDisconnect, async ({ id }) => {
    await supervisor.forget(id);
    modulesService.forget(id);
    return connections.disconnect(id);
  });

  // Runtime control
  handle(IPC_CHANNELS.runtimeStates, () => supervisor.states());
  onAccountChange = () => {
    if (!account.accessState().allowed) void supervisor.stopAll();
  };
  handle(IPC_CHANNELS.runtimeStart, ({ id }) => (assertAccess(), supervisor.start(id)));
  handle(IPC_CHANNELS.runtimeStop, ({ id }) => supervisor.stop(id));
  handle(IPC_CHANNELS.runtimeRestart, ({ id }) => (assertAccess(), supervisor.restart(id)));
  handle(IPC_CHANNELS.runtimeStartAll, () => (assertAccess(), supervisor.startAll()));
  handle(IPC_CHANNELS.runtimeStopAll, () => supervisor.stopAll());

  // Modules
  handle(IPC_CHANNELS.discordGuilds, ({ id, refresh }) => modulesService.guilds(id, refresh));
  handle(IPC_CHANNELS.modulesGet, ({ id }) => modulesService.get(id));
  handle(IPC_CHANNELS.modulesUpdate, ({ id, guildId, moduleId, config }) => modulesService.update(id, guildId, moduleId, config));
  handle(IPC_CHANNELS.modulesTest, ({ id, guildId, test }) => {
    bots.get(id); // unknown bot → NOT_FOUND
    return supervisor.testModule(id, guildId, test);
  });
  handle(IPC_CHANNELS.modulesDoctor, ({ id, guildId }) => {
    bots.get(id);
    return supervisor.doctor(id, guildId);
  });

  // Builders & templates
  handle(IPC_CHANNELS.buildersGet, ({ id }) => buildersService.get(id));
  handle(IPC_CHANNELS.buildersSave, ({ id, builders }) => buildersService.save(id, builders));
  handle(IPC_CHANNELS.workflowRuns, ({ id }) => buildersService.runs(id));
  handle(IPC_CHANNELS.templatesApply, ({ id, guildId, templateId }) => buildersService.applyTemplate(id, guildId, templateId));

  // AI (runs on the DelyForge API; proposals are applied only after the user approves them)
  const ai = new AiAssistant(account, bots, modulesService, buildersService, logs, (botId) => supervisor.state(botId));
  handle(IPC_CHANNELS.aiUsage, () => ai.usage());
  handle(IPC_CHANNELS.aiBuild, ({ id, guildId, prompt }) => ai.build(id, guildId, prompt));
  handle(IPC_CHANNELS.aiApply, ({ proposalId }) => ai.apply(proposalId));
  handle(IPC_CHANNELS.aiReject, ({ proposalId }) => ai.reject(proposalId));
  handle(IPC_CHANNELS.aiTroubleshoot, ({ id, question }) => ai.troubleshoot(id, question));

  // Marketplace (signed, declarative packs only)
  const market = new MarketplaceClient(account, buildersService);
  handle(IPC_CHANNELS.marketList, (filter) => market.list(filter));
  handle(IPC_CHANNELS.marketDetail, ({ slug }) => market.detail(slug));
  handle(IPC_CHANNELS.marketInstall, ({ slug, id, guildId }) => market.install(slug, id, guildId));
  handle(IPC_CHANNELS.marketReview, ({ slug, rating, body }) => market.review(slug, rating, body));
  handle(IPC_CHANNELS.marketDeveloper, () => market.developer());
  handle(IPC_CHANNELS.marketBecomeDeveloper, (input) => market.becomeDeveloper(input));
  handle(IPC_CHANNELS.marketMine, () => market.mine());
  handle(IPC_CHANNELS.marketSubmit, (input) => market.submit(input));
  handle(IPC_CHANNELS.marketQueue, () => market.queue());
  handle(IPC_CHANNELS.marketModerate, ({ versionId, approve, notes }) => market.moderate(versionId, approve, notes));

  // Logs
  handle(IPC_CHANNELS.logsList, ({ id, limit }) => {
    bots.get(id); // NOT_FOUND for unknown bots
    return logs.list(id, limit);
  });
  handle(IPC_CHANNELS.logsClear, ({ id }) => {
    logs.clear(id);
    return null;
  });
  // Members tab: warnings and levels from each bot's own data file
  const members = new MembersService(join(dataDir, 'bots'), bots);
  handle(IPC_CHANNELS.membersData, ({ id, guildId }) => members.data(id, guildId));
  handle(IPC_CHANNELS.membersDeleteWarning, ({ id, guildId, warningId }) => {
    members.deleteWarning(id, guildId, warningId);
    return null;
  });
  handle(IPC_CHANNELS.membersClearWarnings, ({ id, guildId, userId }) => members.clearWarnings(id, guildId, userId));
  handle(IPC_CHANNELS.membersResetXp, ({ id, guildId, userId }) => members.resetXp(id, guildId, userId));

  // Automatic updates for installed copies: from GitHub Releases, or a commercial build's own update address.
  const updateUrl = __DELYFORGE_UPDATE_URL__;
  const updater = createUpdater({ enabled: app.isPackaged, url: updateUrl, localDir: __DELYFORGE_LOCAL_UPDATE_DIR__, logger, onReady: (version) => emit({ type: 'update-ready', version }) });
  handle(IPC_CHANNELS.updatesStatus, () => updater.status());
  handle(IPC_CHANNELS.updatesCheck, () => updater.check());
  handle(IPC_CHANNELS.updatesInstall, () => {
    updater.install();
    return null;
  });

  // Internal admin dashboard (staff only; the API checks the role on every call)
  handle(IPC_CHANNELS.adminOverview, () => account.authed<AdminOverview>('GET', '/v1/admin/overview'));
  handle(IPC_CHANNELS.adminUsers, ({ q }) => account.authed<AdminUser[]>('GET', `/v1/admin/users?q=${encodeURIComponent(q)}`));
  handle(IPC_CHANNELS.adminAudit, () => account.authed<AdminAuditEntry[]>('GET', '/v1/admin/audit'));
  handle(IPC_CHANNELS.adminUserStatus, ({ id, ...body }) => account.authed<null>('POST', `/v1/admin/users/${encodeURIComponent(id)}/status`, body));
  handle(IPC_CHANNELS.adminGrant, ({ workspaceId, ...body }) => account.authed<null>('POST', `/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/overrides`, body));
  handle(IPC_CHANNELS.adminRole, ({ id, role }) => account.authed<null>('POST', `/v1/admin/users/${encodeURIComponent(id)}/role`, { role }));
  handle(IPC_CHANNELS.adminRevoke, ({ id }) => account.authed<null>('DELETE', `/v1/admin/overrides/${encodeURIComponent(id)}`));
  handle(IPC_CHANNELS.adminListingStatus, ({ slug, ...body }) => account.authed<null>('POST', `/v1/admin/listings/${encodeURIComponent(slug)}/status`, body));
  handle(IPC_CHANNELS.adminReviewHidden, ({ id, hidden }) => account.authed<null>('POST', `/v1/admin/reviews/${encodeURIComponent(id)}/hidden`, { hidden }));

  // Team workspaces (Business): members share the active workspace's plan and AI credits
  const enc = encodeURIComponent;
  handle(IPC_CHANNELS.teamInfo, () => account.authed<TeamInfo>('GET', '/v1/team'));
  handle(IPC_CHANNELS.teamInvite, (input) => account.authed<null>('POST', '/v1/team/invites', input));
  handle(IPC_CHANNELS.teamRevokeInvite, ({ id }) => account.authed<null>('DELETE', `/v1/team/invites/${enc(id)}`));
  handle(IPC_CHANNELS.teamRemoveMember, async ({ userId }) => {
    const leaving = account.status().profile?.id === userId;
    await account.authed<null>('DELETE', `/v1/team/members/${enc(userId)}`);
    // Leaving the active team: go back to the personal workspace and its plan.
    if (leaving) await account.refreshPlan().catch(() => null);
    return null;
  });
  handle(IPC_CHANNELS.teamMyInvites, () => account.authed<PendingInvite[]>('GET', '/v1/team/my-invites'));
  handle(IPC_CHANNELS.teamAccept, async ({ id }) => {
    const { workspaceId } = await account.authed<{ workspaceId: string }>('POST', `/v1/team/my-invites/${enc(id)}/accept`);
    return account.switchWorkspace(workspaceId);
  });
  handle(IPC_CHANNELS.teamSwitch, ({ workspaceId }) => account.switchWorkspace(workspaceId));

  // Backups (Pro): daily, settings only — tokens are never included
  const backups = new BackupService(join(dataDir, 'backups'), bots, entitlements, app.getVersion(), (botId) => {
    supervisor.applyModules(botId);
    supervisor.applyBuilders(botId);
  });
  const backupIfDue = () => void backups.runIfDue().catch((err) => logger.warn('Automatic backup failed', err));
  setTimeout(backupIfDue, 60_000).unref();
  setInterval(backupIfDue, 6 * 60 * 60_000).unref();
  handle(IPC_CHANNELS.backupsList, () => backups.list());
  handle(IPC_CHANNELS.backupsRun, () => backups.run());
  handle(IPC_CHANNELS.backupsRestore, async ({ file, id }) => {
    await backups.restore(file, id);
    return null;
  });

  // Analytics (local, counts only)
  const advancedAnalytics = () => entitlements().features.includes('analytics.advanced');
  handle(IPC_CHANNELS.analyticsReport, ({ id, days }) => {
    if (id) bots.get(id);
    const report = analytics.report(Math.min(days, advancedAnalytics() ? ANALYTICS_DAYS.advanced : ANALYTICS_DAYS.basic), id);
    return advancedAnalytics() ? report : { ...report, topCommands: [] };
  });
  handle(IPC_CHANNELS.analyticsExport, async (_input, event) => {
    if (!advancedAnalytics()) throw new AppError('FORBIDDEN', `CSV export is part of advanced analytics on the ${lowestPlanWithFeature('analytics.advanced')?.name ?? 'Pro'} plan.`);
    const result = await saveDialog(event, {
      title: 'Export analytics',
      defaultPath: join(app.getPath('documents'), `delyforge-analytics-${new Date().toISOString().slice(0, 10)}.csv`),
      filters: [{ name: 'CSV spreadsheet', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false, fileName: null };
    const nameOf = (botId: string) => bots.list().find((b) => b.id === botId)?.name ?? 'Deleted bot';
    await writeFile(result.filePath, analytics.csv(ANALYTICS_DAYS.advanced, nameOf), 'utf8');
    return { saved: true, fileName: basename(result.filePath) };
  });

  handle(IPC_CHANNELS.logsExport, async ({ id }, event) => {
    const project = bots.get(id);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const result = await saveDialog(event, {
      title: `Download logs for “${project.name}”`,
      defaultPath: join(app.getPath('documents'), `${slugify(project.name)}-logs-${stamp}.log`),
      filters: [{ name: 'Log file', extensions: ['log', 'txt'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false, fileName: null };
    await writeFile(result.filePath, logs.toText(id), 'utf8');
    return { saved: true, fileName: basename(result.filePath) };
  });

  // Notifications
  handle(IPC_CHANNELS.notificationsList, () => notifications.list());
  handle(IPC_CHANNELS.notificationsMarkRead, ({ ids }) => {
    notifications.markRead(ids);
    return null;
  });
  handle(IPC_CHANNELS.notificationsClear, () => {
    notifications.clear();
    return null;
  });

  const win = createMainWindow();
  nativeTheme.on('updated', () => {
    const palette = nativeTheme.shouldUseDarkColors ? TITLEBAR.dark : TITLEBAR.light;
    if (!win.isDestroyed() && process.platform !== 'darwin') win.setTitleBarOverlay({ ...palette, height: 40 });
  });

  const tray = setupTray({
    win,
    runInBackground: () => settings.get().runInBackground,
    startAll: () => void supervisor.startAll(),
    stopAll: () => void supervisor.stopAll(),
    onlineCount: () => supervisor.onlineCount(),
  });
  app.on('second-instance', () => tray.show());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Stop every bot cleanly before quitting, so each disconnects from Discord properly.
  let shuttingDown = false;
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    const timeout = new Promise((r) => setTimeout(r, 8_000));
    void Promise.race([supervisor.shutdown(), timeout]).finally(() => {
      try {
        db.close();
      } catch {
        // already closed
      }
      app.quit();
    });
  });

  // The smoke test creates and changes bots, so it only runs on a throw-away profile (always the case in development
  // via scripts/smoke.mjs; an installed copy needs DELYFORGE_USER_DATA too, so customer data can never be touched).
  const smokeDir = process.env['DELYFORGE_SMOKE_DIR'] && (!app.isPackaged || process.env['DELYFORGE_USER_DATA']) ? process.env['DELYFORGE_SMOKE_DIR'] : null;
  if (!smokeDir && account.accessState().allowed) supervisor.startOnLaunch();

  if (smokeDir) {
    void runSmokeTest(win, smokeDir, logger, {
      runtimeProbe: async (botId) => {
        // Clearly fake, correctly shaped token: Discord answers 401, or login fails if offline.
        const fake = 'MTAxMjM0NTY3ODkwMTIzNDU2Nw.GaBcDe.' + 'smoke-test-not-a-real-token-0000000';
        secrets.save(botId, fake, '000000000000000000');
        let launched = false;
        supervisor.start(botId);
        for (let i = 0; i < 200; i++) {
          const st = supervisor.state(botId);
          if (st.pid !== null) launched = true;
          if (st.status === 'error' || st.status === 'crashed') break;
          await new Promise((r) => setTimeout(r, 100));
        }
        const errorCode = supervisor.state(botId).lastError?.code ?? null;
        await supervisor.stop(botId);
        secrets.remove(botId);
        return { launched, errorCode };
      },
    });
  }
}

function saveDialog(event: IpcMainInvokeEvent, options: Electron.SaveDialogOptions) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options);
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
    // Started with Windows: stay in the tray until the person opens it.
    if (!process.env['DELYFORGE_SMOKE_DIR'] && !process.argv.includes('--hidden')) win.show();
  });

  if (isDev && DEV_SERVER_URL) void win.loadURL(DEV_SERVER_URL);
  else void win.loadURL(`${APP_ORIGIN}/index.html`);

  return win;
}
