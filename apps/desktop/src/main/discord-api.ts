import { type GuildChannelKind, type GuildInfo, discordAvatarUrl } from '@delyforge/shared';
import { AppError } from './errors';

const CHANNEL_KINDS: Record<number, GuildChannelKind> = {
  0: 'text',
  2: 'voice',
  4: 'category',
  5: 'announcement',
  13: 'voice',
  15: 'forum',
};

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

  /**
   * The servers the bot is in, with channels and roles, for the settings pickers. Works while the bot is offline.
   * Requests are made one after another (max 25 servers) to stay well inside Discord's rate limits.
   */
  async guildStructure(token: string): Promise<GuildInfo[]> {
    const me = await this.get<{ id: string }>('/users/@me', token);
    const guilds = await this.get<{ id: string; name: string; icon: string | null }[]>('/users/@me/guilds?limit=25', token);
    const out: GuildInfo[] = [];
    for (const g of guilds.slice(0, 25)) {
      const channels = await this.get<{ id: string; name: string; type: number; parent_id: string | null; position: number }[]>(
        `/guilds/${g.id}/channels`,
        token,
      );
      const roles = await this.get<{ id: string; name: string; color: number; position: number; managed: boolean; permissions: string }[]>(
        `/guilds/${g.id}/roles`,
        token,
      );
      const member = await this.get<{ roles: string[] }>(`/guilds/${g.id}/members/${me.id}`, token);
      const mine = roles.filter((r) => r.id === g.id || member.roles.includes(r.id));
      let perms = mine.reduce((acc, r) => acc | BigInt(r.permissions), 0n);
      if ((perms & (1n << 3n)) !== 0n) perms = (1n << 53n) - 1n; // Administrator → everything
      out.push({
        id: g.id,
        name: g.name,
        iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
        channels: channels
          .map((c) => ({ id: c.id, name: c.name, kind: CHANNEL_KINDS[c.type] ?? 'other', parentId: c.parent_id, position: c.position }))
          .sort((a, b) => a.position - b.position),
        roles: roles
          .filter((r) => r.id !== g.id) // @everyone
          .map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, managed: r.managed }))
          .sort((a, b) => b.position - a.position),
        botRolePosition: Math.max(0, ...mine.map((r) => r.position)),
        botPermissions: perms.toString(),
      });
    }
    return out;
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
