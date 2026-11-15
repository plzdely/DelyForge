import {
  type BotModules,
  type Entitlements,
  type GuildInfo,
  type ImplementedModuleId,
  type ModuleUpdateResult,
  lowestPlanWithFeature,
  moduleConfigSchemas,
  moduleInfo,
} from '@delyforge/shared';
import type { BotRepository } from '../db/bots';
import type { ActivityRepository } from '../db/repositories';
import type { SecretRepository } from '../db/secrets';
import type { DiscordApi } from '../discord-api';
import { AppError } from '../errors';

const CACHE_MS = 60_000;

/** Module settings (validated + plan-checked) and the server structure used by the settings pickers. */
export class ModulesService {
  private readonly guildCache = new Map<string, { at: number; data: GuildInfo[] }>();

  constructor(
    private readonly bots: BotRepository,
    private readonly secrets: SecretRepository,
    private readonly api: DiscordApi,
    private readonly activity: ActivityRepository,
    private readonly entitlements: () => Pick<Entitlements, 'features'>,
    /** Pushes new settings to the running bot; returns whether a restart is needed. */
    private readonly applyToRunningBot: (botId: string) => boolean,
  ) {}

  get(botId: string): BotModules {
    return this.bots.modules(botId);
  }

  update(botId: string, guildId: string, moduleId: ImplementedModuleId, raw: unknown): ModuleUpdateResult {
    const project = this.bots.get(botId);
    const parsed = moduleConfigSchemas[moduleId].safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError('VALIDATION_FAILED', `${issue?.message ?? 'Invalid settings'}${issue?.path.length ? ` (${issue.path.join('.')})` : ''}`);
    }
    const config = parsed.data as { enabled: boolean };
    const features = this.entitlements().features;
    const info = moduleInfo(moduleId);

    if (config.enabled && !features.includes(info.feature)) {
      const plan = lowestPlanWithFeature(info.feature);
      throw new AppError('FORBIDDEN', `${info.name} is available on the ${plan?.name ?? 'Pro'} plan.`);
    }
    if (moduleId === 'moderation' && (config as { automod?: { enabled: boolean } }).automod?.enabled && !features.includes('moderation.advanced')) {
      const plan = lowestPlanWithFeature('moderation.advanced');
      throw new AppError('FORBIDDEN', `Auto-moderation is available on the ${plan?.name ?? 'Pro'} plan.`);
    }

    const modules = this.bots.modules(botId);
    const before = modules[guildId]?.[moduleId] as { enabled: boolean } | undefined;
    modules[guildId] = { ...(modules[guildId] ?? {}), [moduleId]: parsed.data };
    this.bots.setModules(botId, modules);

    const verb = !before?.enabled && config.enabled ? 'Enabled' : before?.enabled && !config.enabled ? 'Disabled' : 'Updated';
    this.activity.record('module', `${verb} ${info.name}${verb === 'Updated' ? ' settings' : ''} for “${project.name}”`, botId);

    return { modules, restartRequired: this.applyToRunningBot(botId) };
  }

  async guilds(botId: string, refresh = false): Promise<GuildInfo[]> {
    const project = this.bots.get(botId);
    if (!project.hasToken) throw new AppError('VALIDATION_FAILED', 'Connect this bot to Discord first.');
    const cached = this.guildCache.get(botId);
    if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.data;

    const token = this.secrets.get(botId);
    if (!token) throw new AppError('VALIDATION_FAILED', 'Connect this bot to Discord first.');
    if (refresh) {
      // Also re-read the application's privileged intent switches, in case they were changed in the portal.
      const verified = await this.api.verifyBot(token);
      this.bots.setConnection(botId, {
        applicationId: verified.applicationId,
        username: verified.username,
        avatarUrl: verified.avatarUrl,
        applicationFlags: verified.applicationFlags,
      });
    }
    const data = await this.api.guildStructure(token);
    this.guildCache.set(botId, { at: Date.now(), data });
    return data;
  }

  forget(botId: string): void {
    this.guildCache.delete(botId);
  }
}
