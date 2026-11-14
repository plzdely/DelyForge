import { type BotProject, checkTokenShape } from '@delyforge/shared';
import type { BotRepository } from '../db/bots';
import type { ActivityRepository } from '../db/repositories';
import type { SecretRepository } from '../db/secrets';
import type { DiscordApi } from '../discord-api';
import { AppError } from '../errors';

/** Connecting a bot project to a Discord application: verify → check for conflicts → store encrypted. */
export class BotConnections {
  constructor(
    private readonly bots: BotRepository,
    private readonly secrets: SecretRepository,
    private readonly api: DiscordApi,
    private readonly activity: ActivityRepository,
  ) {}

  async connect(id: string, rawToken: string): Promise<BotProject> {
    const project = this.bots.get(id);
    const check = checkTokenShape(rawToken);
    if (!check.ok) throw new AppError('VALIDATION_FAILED', check.message);

    const verified = await this.api.verifyBot(check.token);
    const other = this.bots.findByApplicationId(verified.applicationId, id);
    if (other) {
      throw new AppError(
        'CONFLICT',
        `This Discord bot is already connected to “${other.name}”. One Discord bot can only be used by one project at a time.`,
      );
    }

    this.secrets.save(id, check.token, verified.applicationId);
    const updated = this.bots.setConnection(id, {
      applicationId: verified.applicationId,
      username: verified.username,
      avatarUrl: verified.avatarUrl,
      applicationFlags: verified.applicationFlags,
    });
    this.activity.record('bot', `Connected “${project.name}” to Discord as ${verified.username}`, id);
    return updated;
  }

  disconnect(id: string): BotProject {
    const project = this.bots.get(id);
    this.secrets.remove(id);
    const updated = this.bots.clearConnection(id);
    this.activity.record('bot', `Disconnected “${project.name}” from Discord`, id);
    return updated;
  }
}
