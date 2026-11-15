import { z } from 'zod';
import {
  type AnalyticsReport,
  type BackupInfo,
  type UpdateStatus,
  type AppNotification,
  type BotEvent,
  type BotLogEntry,
  type BotProject,
  type BotRuntimeState,
  type ExportResult,
  type ImportResult,
  botIdInputSchema,
  connectBotSchema,
  createBotProjectSchema,
  logsListSchema,
  markNotificationsSchema,
  updateBotProjectSchema,
} from './bots.js';
import type { Entitlements } from './entitlements.js';
import { type BotModules, type GuildInfo, type ModuleUpdateResult, updateModuleSchema } from './modules.js';
import { type Builders, type WorkflowRun, saveBuildersSchema } from './builders.js';
import {
  type AccountStatus,
  type InvoiceInfo,
  type PendingInvite,
  type TeamInfo,
  switchWorkspaceSchema,
  teamInviteSchema,
  checkoutSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from './account.js';
import { appSettingsPatchSchema, type AppSettings } from './settings.js';
import { type AdminAuditEntry, type AdminOverview, type AdminUser, adminListingStatusSchema, adminOverrideSchema, adminReviewHiddenSchema, adminRoleSchema, adminUserStatusSchema } from './admin.js';
import type { AiProposalResult, AiTroubleshootAnswer, AiUsageInfo } from './ai.js';
import { LISTING_TYPES, type ListingDetail, type ListingSummary, type MyListing, type ReviewQueueItem, developerProfileSchema, reviewSchema } from './marketplace.js';
import type { PlanId } from './plans.js';

/**
 * Typed IPC contract between the desktop renderer (UI) and the main process.
 *
 * Every channel is listed here once. The main process validates each payload against `ipcInputSchemas` before acting,
 * so the (untrusted) renderer cannot send unexpected data. See ARCHITECTURE.md §4.
 */

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  dashboardGetSummary: 'dashboard:get-summary',
  shellOpenExternal: 'shell:open-external',
  accountGetEntitlements: 'account:get-entitlements',
  botsList: 'bots:list',
  botsGet: 'bots:get',
  botsCreate: 'bots:create',
  botsUpdate: 'bots:update',
  botsDuplicate: 'bots:duplicate',
  botsDelete: 'bots:delete',
  botsExport: 'bots:export',
  botsImport: 'bots:import',
  botsConnect: 'bots:connect',
  botsDisconnect: 'bots:disconnect',
  runtimeStates: 'runtime:states',
  runtimeStart: 'runtime:start',
  runtimeStop: 'runtime:stop',
  runtimeRestart: 'runtime:restart',
  runtimeStartAll: 'runtime:start-all',
  runtimeStopAll: 'runtime:stop-all',
  logsList: 'logs:list',
  logsClear: 'logs:clear',
  logsExport: 'logs:export',
  notificationsList: 'notifications:list',
  notificationsMarkRead: 'notifications:mark-read',
  notificationsClear: 'notifications:clear',
  clipboardWrite: 'clipboard:write',
  discordGuilds: 'discord:guilds',
  modulesGet: 'modules:get',
  modulesUpdate: 'modules:update',
  buildersGet: 'builders:get',
  buildersSave: 'builders:save',
  workflowRuns: 'builders:workflow-runs',
  templatesApply: 'templates:apply',
  accountStatus: 'account:status',
  accountRegister: 'account:register',
  accountLogin: 'account:login',
  accountLogout: 'account:logout',
  accountRefresh: 'account:refresh',
  accountForgotPassword: 'account:forgot-password',
  accountResendVerification: 'account:resend-verification',
  accountUpdateProfile: 'account:update-profile',
  accountLinkDiscord: 'account:link-discord',
  billingCheckout: 'billing:checkout',
  billingPortal: 'billing:portal',
  billingInvoices: 'billing:invoices',
  aiUsage: 'ai:usage',
  aiBuild: 'ai:build',
  aiApply: 'ai:apply',
  aiReject: 'ai:reject',
  aiTroubleshoot: 'ai:troubleshoot',
  marketList: 'market:list',
  marketDetail: 'market:detail',
  marketInstall: 'market:install',
  marketReview: 'market:review',
  marketDeveloper: 'market:developer',
  marketBecomeDeveloper: 'market:become-developer',
  marketMine: 'market:mine',
  marketSubmit: 'market:submit',
  marketQueue: 'market:queue',
  marketModerate: 'market:moderate',
  analyticsReport: 'analytics:report',
  analyticsExport: 'analytics:export',
  backupsList: 'backups:list',
  backupsRun: 'backups:run',
  backupsRestore: 'backups:restore',
  teamInfo: 'team:info',
  teamInvite: 'team:invite',
  teamRevokeInvite: 'team:revoke-invite',
  teamRemoveMember: 'team:remove-member',
  teamMyInvites: 'team:my-invites',
  teamAccept: 'team:accept',
  teamSwitch: 'team:switch',
  adminOverview: 'admin:overview',
  adminUsers: 'admin:users',
  adminAudit: 'admin:audit',
  adminUserStatus: 'admin:user-status',
  adminGrant: 'admin:grant',
  adminRevoke: 'admin:revoke',
  adminListingStatus: 'admin:listing-status',
  adminReviewHidden: 'admin:review-hidden',
  adminRole: 'admin:role',
  updatesStatus: 'updates:status',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
} as const;
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Main → renderer push channel (not invokable). */
export const BOT_EVENT_CHANNEL = 'bots:event';

/** Hosts the app may open in the user's browser. Keeps a compromised UI from opening arbitrary URLs. */
export const EXTERNAL_URL_ALLOWLIST = [
  'discord.com',
  'support.discord.com',
  'docs.discord.com',
  'github.com',
  'checkout.stripe.com',
  'billing.stripe.com',
  'invoice.stripe.com',
] as const;

export function isAllowedExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    return EXTERNAL_URL_ALLOWLIST.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const noInput = z.undefined();

export const ipcInputSchemas = {
  [IPC_CHANNELS.appGetInfo]: noInput,
  [IPC_CHANNELS.settingsGet]: noInput,
  [IPC_CHANNELS.settingsUpdate]: appSettingsPatchSchema,
  [IPC_CHANNELS.dashboardGetSummary]: noInput,
  [IPC_CHANNELS.shellOpenExternal]: z
    .string()
    .max(2048)
    .refine(isAllowedExternalUrl, { message: 'URL is not on the allow-list' }),
  [IPC_CHANNELS.accountGetEntitlements]: noInput,
  [IPC_CHANNELS.botsList]: noInput,
  [IPC_CHANNELS.botsGet]: botIdInputSchema,
  [IPC_CHANNELS.botsCreate]: createBotProjectSchema,
  [IPC_CHANNELS.botsUpdate]: updateBotProjectSchema,
  [IPC_CHANNELS.botsDuplicate]: botIdInputSchema,
  [IPC_CHANNELS.botsDelete]: botIdInputSchema,
  [IPC_CHANNELS.botsExport]: botIdInputSchema,
  [IPC_CHANNELS.botsImport]: noInput,
  [IPC_CHANNELS.botsConnect]: connectBotSchema,
  [IPC_CHANNELS.botsDisconnect]: botIdInputSchema,
  [IPC_CHANNELS.runtimeStates]: noInput,
  [IPC_CHANNELS.runtimeStart]: botIdInputSchema,
  [IPC_CHANNELS.runtimeStop]: botIdInputSchema,
  [IPC_CHANNELS.runtimeRestart]: botIdInputSchema,
  [IPC_CHANNELS.runtimeStartAll]: noInput,
  [IPC_CHANNELS.runtimeStopAll]: noInput,
  [IPC_CHANNELS.logsList]: logsListSchema,
  [IPC_CHANNELS.logsClear]: botIdInputSchema,
  [IPC_CHANNELS.logsExport]: botIdInputSchema,
  [IPC_CHANNELS.notificationsList]: noInput,
  [IPC_CHANNELS.notificationsMarkRead]: markNotificationsSchema,
  [IPC_CHANNELS.notificationsClear]: noInput,
  [IPC_CHANNELS.clipboardWrite]: z.string().min(1).max(4000),
  [IPC_CHANNELS.discordGuilds]: z.object({ id: z.uuid(), refresh: z.boolean().optional() }).strict(),
  [IPC_CHANNELS.modulesGet]: botIdInputSchema,
  [IPC_CHANNELS.modulesUpdate]: updateModuleSchema,
  [IPC_CHANNELS.buildersGet]: botIdInputSchema,
  [IPC_CHANNELS.buildersSave]: saveBuildersSchema,
  [IPC_CHANNELS.workflowRuns]: botIdInputSchema,
  [IPC_CHANNELS.templatesApply]: z
    .object({ id: z.uuid(), guildId: z.string().regex(/^\d{17,20}$/), templateId: z.string().max(40) })
    .strict(),
  [IPC_CHANNELS.accountStatus]: noInput,
  [IPC_CHANNELS.accountRegister]: registerSchema,
  [IPC_CHANNELS.accountLogin]: loginSchema,
  [IPC_CHANNELS.accountLogout]: noInput,
  [IPC_CHANNELS.accountRefresh]: noInput,
  [IPC_CHANNELS.accountForgotPassword]: forgotPasswordSchema,
  [IPC_CHANNELS.accountResendVerification]: noInput,
  [IPC_CHANNELS.accountUpdateProfile]: updateProfileSchema,
  [IPC_CHANNELS.accountLinkDiscord]: noInput,
  [IPC_CHANNELS.billingCheckout]: checkoutSchema,
  [IPC_CHANNELS.billingPortal]: noInput,
  [IPC_CHANNELS.billingInvoices]: noInput,
  [IPC_CHANNELS.aiUsage]: noInput,
  [IPC_CHANNELS.aiBuild]: z.object({ id: z.uuid(), guildId: z.string().regex(/^\d{17,20}$/), prompt: z.string().trim().min(10).max(2000) }).strict(),
  [IPC_CHANNELS.aiApply]: z.object({ proposalId: z.string().min(1).max(40) }).strict(),
  [IPC_CHANNELS.aiReject]: z.object({ proposalId: z.string().min(1).max(40) }).strict(),
  [IPC_CHANNELS.aiTroubleshoot]: z.object({ id: z.uuid(), question: z.string().trim().max(1000) }).strict(),
  [IPC_CHANNELS.marketList]: z.object({ type: z.enum(LISTING_TYPES).optional(), q: z.string().trim().max(60).optional(), sort: z.enum(['popular', 'rating', 'new']).optional() }).strict(),
  [IPC_CHANNELS.marketDetail]: z.object({ slug: z.string().regex(/^[a-z0-9-]{3,48}$/) }).strict(),
  [IPC_CHANNELS.marketInstall]: z.object({ slug: z.string().regex(/^[a-z0-9-]{3,48}$/), id: z.uuid(), guildId: z.string().regex(/^\d{17,20}$/) }).strict(),
  [IPC_CHANNELS.marketReview]: reviewSchema.extend({ slug: z.string().regex(/^[a-z0-9-]{3,48}$/) }).strict(),
  [IPC_CHANNELS.marketDeveloper]: noInput,
  [IPC_CHANNELS.marketBecomeDeveloper]: developerProfileSchema,
  [IPC_CHANNELS.marketMine]: noInput,
  [IPC_CHANNELS.marketSubmit]: z
    .object({
      id: z.uuid(),
      commandIds: z.array(z.string().max(16)).max(25),
      embedIds: z.array(z.string().max(16)).max(25),
      listing: z
        .object({
          slug: z.string().regex(/^[a-z0-9-]{3,48}$/),
          title: z.string().trim().min(3).max(60),
          summary: z.string().trim().min(10).max(160),
          description: z.string().trim().max(4000),
          category: z.string().trim().min(2).max(30),
          tags: z.array(z.string().trim().min(1).max(20)).max(5),
          version: z.string().regex(/^\d+\.\d+\.\d+$/),
          changelog: z.string().trim().max(1000),
        })
        .strict(),
    })
    .strict(),
  [IPC_CHANNELS.marketQueue]: noInput,
  [IPC_CHANNELS.analyticsReport]: z.object({ id: z.uuid().nullable(), days: z.number().int().min(1).max(90) }).strict(),
  [IPC_CHANNELS.analyticsExport]: noInput,
  [IPC_CHANNELS.updatesStatus]: noInput,
  [IPC_CHANNELS.updatesCheck]: noInput,
  [IPC_CHANNELS.updatesInstall]: noInput,
  [IPC_CHANNELS.adminOverview]: noInput,
  [IPC_CHANNELS.adminUsers]: z.object({ q: z.string().trim().max(100) }).strict(),
  [IPC_CHANNELS.adminAudit]: noInput,
  [IPC_CHANNELS.adminUserStatus]: adminUserStatusSchema.extend({ id: z.string().min(1).max(40) }).strict(),
  [IPC_CHANNELS.adminGrant]: adminOverrideSchema.extend({ workspaceId: z.string().min(1).max(40) }).strict(),
  [IPC_CHANNELS.adminRevoke]: z.object({ id: z.string().min(1).max(40) }).strict(),
  [IPC_CHANNELS.adminRole]: adminRoleSchema.extend({ id: z.string().min(1).max(40) }).strict(),
  [IPC_CHANNELS.adminListingStatus]: adminListingStatusSchema.extend({ slug: z.string().regex(/^[a-z0-9-]{3,48}$/) }).strict(),
  [IPC_CHANNELS.adminReviewHidden]: adminReviewHiddenSchema.extend({ id: z.string().min(1).max(40) }).strict(),
  [IPC_CHANNELS.teamInfo]: noInput,
  [IPC_CHANNELS.teamInvite]: teamInviteSchema,
  [IPC_CHANNELS.teamRevokeInvite]: z.object({ id: z.string().min(1).max(40) }).strict(),
  [IPC_CHANNELS.teamRemoveMember]: z.object({ userId: z.string().min(1).max(40) }).strict(),
  [IPC_CHANNELS.teamMyInvites]: noInput,
  [IPC_CHANNELS.teamAccept]: z.object({ id: z.string().min(1).max(40) }).strict(),
  [IPC_CHANNELS.teamSwitch]: switchWorkspaceSchema,
  [IPC_CHANNELS.backupsList]: noInput,
  [IPC_CHANNELS.backupsRun]: noInput,
  [IPC_CHANNELS.backupsRestore]: z.object({ file: z.string().regex(/^\d{4}-\d{2}-\d{2}\.json$/), id: z.uuid() }).strict(),
  [IPC_CHANNELS.marketModerate]: z.object({ versionId: z.string().min(1).max(40), approve: z.boolean(), notes: z.string().trim().max(1000) }).strict(),
} as const satisfies Record<IpcChannel, z.ZodType>;

// ---------------------------------------------------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------------------------------------------------

export type IpcErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'LIMIT_REACHED'
  | 'CONFLICT'
  | 'DISCORD_REJECTED'
  | 'NETWORK'
  | 'INTERNAL';

export interface IpcError {
  code: IpcErrorCode;
  message: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

// ---------------------------------------------------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------------------------------------------------

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  electron: string;
  node: string;
  chrome: string;
  dataDirectory: string;
}

export type ActivityKind = 'app' | 'bot' | 'module' | 'workflow' | 'account' | 'system';

export interface ActivityItem {
  id: number;
  kind: ActivityKind;
  message: string;
  createdAt: string; // ISO 8601
}

export interface DashboardSummary {
  totalProjects: number;
  onlineBots: number;
  offlineBots: number;
  /** Sum of the last known server counts of every bot. */
  totalServers: number;
  /** Slash commands handled by all bots, all time. */
  totalCommands: number;
  unreadNotifications: number;
  recentActivity: ActivityItem[];
  /** Plan applied locally. Until accounts ship (Phase 7) this is always the Free plan. */
  localPlanId: PlanId;
  /** False until the cloud account system is connected. */
  accountConnected: boolean;
}

/** The API exposed to the renderer as `window.delyforge`. */
export interface DelyForgeBridge {
  app: {
    getInfo(): Promise<IpcResult<AppInfo>>;
  };
  settings: {
    get(): Promise<IpcResult<AppSettings>>;
    update(patch: z.input<typeof appSettingsPatchSchema>): Promise<IpcResult<AppSettings>>;
  };
  dashboard: {
    getSummary(): Promise<IpcResult<DashboardSummary>>;
  };
  shell: {
    openExternal(url: string): Promise<IpcResult<null>>;
  };
  account: {
    getEntitlements(): Promise<IpcResult<AccountEntitlements>>;
    status(): Promise<IpcResult<AccountStatus>>;
    register(input: z.input<typeof registerSchema>): Promise<IpcResult<AccountStatus>>;
    login(input: z.input<typeof loginSchema>): Promise<IpcResult<AccountStatus>>;
    logout(): Promise<IpcResult<AccountStatus>>;
    /** Re-checks the plan with the server (e.g. right after paying). */
    refresh(): Promise<IpcResult<AccountStatus>>;
    forgotPassword(email: string): Promise<IpcResult<null>>;
    resendVerification(): Promise<IpcResult<null>>;
    updateProfile(displayName: string): Promise<IpcResult<AccountStatus>>;
    /** Opens Discord in the browser and waits (up to 10 minutes) until the person approves; then links it. */
    linkDiscord(): Promise<IpcResult<AccountStatus>>;
  };
  billing: {
    /** Opens Stripe Checkout in the browser. */
    checkout(input: z.input<typeof checkoutSchema>): Promise<IpcResult<null>>;
    portal(): Promise<IpcResult<null>>;
    invoices(): Promise<IpcResult<InvoiceInfo[]>>;
  };
  bots: {
    list(): Promise<IpcResult<BotProject[]>>;
    get(id: string): Promise<IpcResult<BotProject>>;
    create(input: z.input<typeof createBotProjectSchema>): Promise<IpcResult<BotProject>>;
    update(input: z.input<typeof updateBotProjectSchema>): Promise<IpcResult<BotProject>>;
    duplicate(id: string): Promise<IpcResult<BotProject>>;
    remove(id: string): Promise<IpcResult<null>>;
    exportToFile(id: string): Promise<IpcResult<ExportResult>>;
    importFromFile(): Promise<IpcResult<ImportResult>>;
    /** Verifies the token with Discord, then stores it encrypted. The token is never returned. */
    connect(id: string, token: string): Promise<IpcResult<BotProject>>;
    disconnect(id: string): Promise<IpcResult<BotProject>>;
  };
  runtime: {
    states(): Promise<IpcResult<BotRuntimeState[]>>;
    start(id: string): Promise<IpcResult<BotRuntimeState>>;
    stop(id: string): Promise<IpcResult<BotRuntimeState>>;
    restart(id: string): Promise<IpcResult<BotRuntimeState>>;
    startAll(): Promise<IpcResult<{ started: number; skipped: number }>>;
    stopAll(): Promise<IpcResult<{ stopped: number }>>;
  };
  logs: {
    list(id: string, limit?: number): Promise<IpcResult<BotLogEntry[]>>;
    clear(id: string): Promise<IpcResult<null>>;
    exportToFile(id: string): Promise<IpcResult<ExportResult>>;
  };
  notifications: {
    list(): Promise<IpcResult<AppNotification[]>>;
    markRead(ids?: number[]): Promise<IpcResult<null>>;
    clear(): Promise<IpcResult<null>>;
  };
  clipboard: {
    writeText(text: string): Promise<IpcResult<null>>;
  };
  discord: {
    /** The bot's servers with channels and roles (cached for a minute; `refresh` re-checks with Discord). */
    guilds(id: string, refresh?: boolean): Promise<IpcResult<GuildInfo[]>>;
  };
  modules: {
    get(id: string): Promise<IpcResult<BotModules>>;
    update(input: z.input<typeof updateModuleSchema>): Promise<IpcResult<ModuleUpdateResult>>;
  };
  builders: {
    get(id: string): Promise<IpcResult<Builders>>;
    /** Saves all of a bot's commands, embeds and workflows at once (validated as a whole). */
    save(id: string, builders: Builders): Promise<IpcResult<Builders>>;
    workflowRuns(id: string): Promise<IpcResult<WorkflowRun[]>>;
  };
  templates: {
    apply(input: { id: string; guildId: string; templateId: string }): Promise<IpcResult<{ modules: BotModules; builders: Builders }>>;
  };
  ai: {
    usage(): Promise<IpcResult<AiUsageInfo>>;
    /** Asks the AI for a proposal for one server. Nothing changes until `apply`. */
    build(input: { id: string; guildId: string; prompt: string }): Promise<IpcResult<AiProposalResult>>;
    apply(proposalId: string): Promise<IpcResult<AiApplyResult>>;
    reject(proposalId: string): Promise<IpcResult<null>>;
    troubleshoot(input: { id: string; question: string }): Promise<IpcResult<{ answer: AiTroubleshootAnswer; creditsUsed: number; usage: AiUsageInfo }>>;
  };
  updates: {
    status(): Promise<IpcResult<UpdateStatus>>;
    check(): Promise<IpcResult<UpdateStatus>>;
    /** Restarts into the downloaded update (only when one is ready). */
    install(): Promise<IpcResult<null>>;
  };
  /** DelyForge staff only — the server checks the role on every call. */
  admin: {
    overview(): Promise<IpcResult<AdminOverview>>;
    users(q: string): Promise<IpcResult<AdminUser[]>>;
    audit(): Promise<IpcResult<AdminAuditEntry[]>>;
    setUserStatus(input: z.input<(typeof ipcInputSchemas)['admin:user-status']>): Promise<IpcResult<null>>;
    grant(input: z.input<(typeof ipcInputSchemas)['admin:grant']>): Promise<IpcResult<null>>;
    revoke(id: string): Promise<IpcResult<null>>;
    /** Gives or removes staff access (admins only; not your own). */
    setRole(input: { id: string; role: 'USER' | 'SUPPORT' | 'ADMIN' }): Promise<IpcResult<null>>;
    setListingStatus(input: z.input<(typeof ipcInputSchemas)['admin:listing-status']>): Promise<IpcResult<null>>;
    setReviewHidden(input: { id: string; hidden: boolean }): Promise<IpcResult<null>>;
  };
  team: {
    info(): Promise<IpcResult<TeamInfo>>;
    invite(input: z.input<typeof teamInviteSchema>): Promise<IpcResult<null>>;
    revokeInvite(id: string): Promise<IpcResult<null>>;
    /** Removes someone (owner/admin), or leaves when it's your own ID. */
    removeMember(userId: string): Promise<IpcResult<null>>;
    myInvites(): Promise<IpcResult<PendingInvite[]>>;
    /** Joins the team and makes it active on this computer. */
    accept(id: string): Promise<IpcResult<AccountStatus>>;
    switchTo(workspaceId: string): Promise<IpcResult<AccountStatus>>;
  };
  backups: {
    list(): Promise<IpcResult<BackupInfo[]>>;
    /** Backs up every bot now (Pro). */
    run(): Promise<IpcResult<BackupInfo>>;
    /** Puts one bot's settings back to how they were in that backup. */
    restore(input: { file: string; id: string }): Promise<IpcResult<null>>;
  };
  analytics: {
    /** Days are capped by the plan (7 on basic analytics, 90 on advanced). `id` null = all bots. */
    report(input: { id: string | null; days: number }): Promise<IpcResult<AnalyticsReport>>;
    /** Advanced analytics only: saves a CSV with one row per bot per day. */
    exportCsv(): Promise<IpcResult<ExportResult>>;
  };
  marketplace: {
    list(filter: z.input<(typeof ipcInputSchemas)['market:list']>): Promise<IpcResult<ListingSummary[]>>;
    detail(slug: string): Promise<IpcResult<ListingDetail>>;
    /** Downloads the signed pack, verifies DelyForge's signature, then installs it into one server. */
    install(input: { slug: string; id: string; guildId: string }): Promise<IpcResult<{ modules: BotModules; builders: Builders }>>;
    review(input: { slug: string; rating: number; body: string }): Promise<IpcResult<null>>;
    developer(): Promise<IpcResult<{ displayName: string; slug: string } | null>>;
    becomeDeveloper(input: { displayName: string; slug: string }): Promise<IpcResult<{ displayName: string; slug: string }>>;
    mine(): Promise<IpcResult<MyListing[]>>;
    submit(input: z.input<(typeof ipcInputSchemas)['market:submit']>): Promise<IpcResult<MyListing>>;
    /** Staff only (the server checks). */
    queue(): Promise<IpcResult<ReviewQueueItem[]>>;
    moderate(input: { versionId: string; approve: boolean; notes: string }): Promise<IpcResult<null>>;
  };
  events: {
    /** Subscribe to live bot events. Returns an unsubscribe function. */
    onBotEvent(listener: (event: BotEvent) => void): () => void;
  };
}

export interface AiApplyResult {
  applied: string[];
  /** Items that could not be applied (plan limits, name clashes), with the reason. */
  skipped: string[];
  restartRequired: boolean;
}

/** Entitlements as resolved by the main process (the UI never decides what a customer may use). */
export interface AccountEntitlements extends Omit<Entitlements, 'graceEndsAt'> {
  graceEndsAt: string | null;
  /** `local` until accounts ship; `dev-override` only in unpackaged development builds. */
  source: 'local' | 'dev-override' | 'account' | 'personal';
}
