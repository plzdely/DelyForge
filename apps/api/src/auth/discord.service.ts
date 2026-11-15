import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { randomToken, sha256 } from './crypto';

const STATE_TTL_MS = 10 * 60_000;
const DISCORD = 'https://discord.com';
const tokenSchema = z.object({ access_token: z.string() });
const userSchema = z.object({ id: z.string().regex(/^\d{17,20}$/), username: z.string(), global_name: z.string().nullish(), avatar: z.string().nullish() });

export interface LinkOutcome {
  ok: boolean;
  title: string;
  message: string;
}

/**
 * Links a DelyForge account to the person's Discord account using Discord's own sign-in page (OAuth2, `identify`
 * scope only). We keep the Discord ID, name and avatar — never a Discord token. Banned Discord accounts can't be linked.
 */
@Injectable()
export class DiscordLinkService {
  private readonly logger = new Logger(DiscordLinkService.name);
  /** Replaced in tests; Discord is never called by the test suite. */
  fetchImpl: typeof fetch = (...args) => fetch(...args);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get configured(): boolean {
    return Boolean(this.env.DISCORD_CLIENT_ID && this.env.DISCORD_CLIENT_SECRET);
  }

  private get redirectUri(): string {
    return `${this.env.PUBLIC_API_URL}/v1/auth/discord/callback`;
  }

  /** The Discord page the app opens in the browser. The one-time `state` ties the answer to this account. */
  async start(userId: string, now = new Date()): Promise<{ url: string }> {
    if (!this.configured) throw new ServiceUnavailableException('Discord linking isn’t set up on this server yet.');
    const state = randomToken(32);
    await this.prisma.emailToken.create({ data: { userId, purpose: 'DISCORD_LINK', tokenHash: sha256(state), expiresAt: new Date(now.getTime() + STATE_TTL_MS) } });
    const q = new URLSearchParams({ client_id: this.env.DISCORD_CLIENT_ID, redirect_uri: this.redirectUri, response_type: 'code', scope: 'identify', state, prompt: 'consent' });
    return { url: `${DISCORD}/oauth2/authorize?${q}` };
  }

  /** Discord sends the browser back here. Returns what the page should say. */
  async callback(input: { code?: string; state?: string; error?: string }, now = new Date()): Promise<LinkOutcome> {
    const fail = (message: string): LinkOutcome => ({ ok: false, title: 'Discord not connected', message });
    if (!this.configured) return fail('Discord linking isn’t set up on this server yet.');
    if (input.error) return fail('You cancelled on Discord. Go back to DelyForge and try again.');
    if (!input.code || !input.state) return fail('This link is incomplete. Go back to DelyForge and try again.');

    const token = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(input.state) } });
    if (!token || token.purpose !== 'DISCORD_LINK' || token.consumedAt || token.expiresAt < now) return fail('This link has expired. Go back to DelyForge and click “Connect Discord” again.');
    const claimed = await this.prisma.emailToken.updateMany({ where: { id: token.id, consumedAt: null }, data: { consumedAt: now } });
    if (!claimed.count) return fail('This link was already used.');

    let discordUser: z.infer<typeof userSchema>;
    try {
      const res = await this.fetchImpl(`${DISCORD}/api/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.env.DISCORD_CLIENT_ID, client_secret: this.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: input.code, redirect_uri: this.redirectUri }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return fail('Discord didn’t accept the sign-in. Please try again.');
      const { access_token } = tokenSchema.parse(await res.json());
      const me = await this.fetchImpl(`${DISCORD}/api/users/@me`, { headers: { authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10_000) });
      if (!me.ok) return fail('Discord didn’t share your account. Please try again.');
      discordUser = userSchema.parse(await me.json());
    } catch (e) {
      this.logger.warn(`Discord link failed: ${(e as Error).message}`);
      return fail('Couldn’t reach Discord. Please try again in a minute.');
    }

    if (await this.prisma.ban.findUnique({ where: { kind_value: { kind: 'DISCORD', value: discordUser.id } } })) {
      await this.prisma.auditLog.create({ data: { actorId: token.userId, action: 'discord.link_blocked_banned', metadata: { discordId: discordUser.id } } });
      return fail('This Discord account can’t be used with DelyForge.');
    }
    const other = await this.prisma.user.findUnique({ where: { discordId: discordUser.id } });
    if (other && other.id !== token.userId) return fail('This Discord account is already linked to another DelyForge account.');

    await this.prisma.user.update({
      where: { id: token.userId },
      data: {
        discordId: discordUser.id,
        discordUsername: discordUser.global_name || discordUser.username,
        discordAvatarUrl: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128` : null,
        discordLinkedAt: now,
      },
    });
    await this.prisma.auditLog.create({ data: { actorId: token.userId, action: 'discord.linked', metadata: { discordId: discordUser.id } } });
    return { ok: true, title: 'Discord connected', message: `Linked to ${discordUser.global_name || discordUser.username}. You can close this tab and go back to DelyForge.` };
  }
}
