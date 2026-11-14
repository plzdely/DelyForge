import { discordAvatarUrl } from '@delyforge/shared';
import { AppError } from './errors';

export interface VerifiedBot {
  applicationId: string;
  applicationName: string;
  applicationFlags: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
}

/**
 * Minimal Discord REST client used to verify a token before it is saved.
 * Only official endpoints are used: GET /users/@me and GET /applications/@me.
 */
export class DiscordApi {
  constructor(
    private readonly appVersion: string,
    private readonly baseUrl = 'https://discord.com/api/v10',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string, token: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          Authorization: `Bot ${token}`,
          'User-Agent': `DiscordBot (DelyForge, ${this.appVersion})`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('NETWORK', 'Couldn’t reach Discord. Check your internet connection and try again.');
    }
    if (res.status === 401) {
      throw new AppError(
        'DISCORD_REJECTED',
        'Discord says this token is not valid. On the Bot tab, click Reset Token, copy the new token and paste it here.',
      );
    }
    if (res.status === 429) {
      throw new AppError('NETWORK', 'Discord is limiting requests right now. Wait a minute and try again.');
    }
    if (!res.ok) {
      throw new AppError('NETWORK', `Discord returned an unexpected error (${res.status}). Try again in a moment.`);
    }
    return (await res.json()) as T;
  }

  async verifyBot(token: string): Promise<VerifiedBot> {
    const user = await this.get<{ id: string; username: string; avatar: string | null; bot?: boolean }>('/users/@me', token);
    if (!user.bot) {
      throw new AppError('DISCORD_REJECTED', 'This token belongs to a user account, not a bot. Use the token from your application’s Bot tab.');
    }
    const app = await this.get<{ id: string; name: string; flags?: number }>('/applications/@me', token);
    return {
      applicationId: app.id,
      applicationName: app.name,
      applicationFlags: app.flags ?? 0,
      userId: user.id,
      username: user.username,
      avatarUrl: discordAvatarUrl(user.id, user.avatar),
    };
  }
}
