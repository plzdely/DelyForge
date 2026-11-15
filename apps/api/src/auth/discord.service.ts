import { ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { DISCORD_LOOPBACK } from '@delyforge/shared';
import { z } from 'zod';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { randomToken, sha256 } from './crypto';

const STATE_TTL_MS = 10 * 60_000;
const DISCORD = 'https://discord.com';
/** Discord returns the answer to the DelyForge app on the same computer (RFC 8252 loopback redirect). */
const REDIRECT_URI = `http://127.0.0.1:${DISCORD_LOOPBACK.port}${DISCORD_LOOPBACK.path}`;
const tokenSchema = z.object({ access_token: z.string() });
const userSchema = z.object({ id: z.string().regex(/^\d{17,20}$/), username: z.string(), global_name: z.string().nullish(), avatar: z.string().nullish() });

/**
 * Links a DelyForge account to the person's Discord account using Discord's own sign-in page (OAuth2, `identify`
 * scope only). We keep the Discord ID, name and avatar — never a Discord token. Banned Discord accounts can't be linked.
 *
 * Discord sends its answer to the DelyForge app on the person's own computer, and that app — signed in as the account
 * that started — finishes the link. A link someone else sends you therefore can't attach your Discord account to theirs:
 * Discord's answer lands on your computer, and your app is either not waiting for it or signed in as someone else.
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

  /** The Discord page the app opens in the browser. The one-time `state` ties the answer to this account. */
  async start(userId: string, now = new Date()): Promise<{ url: string }> {
    if (!this.configured) throw new ServiceUnavailableException('Discord linking isn’t set up on this server yet.');
    const state = randomToken(32);
    // Only the newest "Connect Discord" link works.
    await this.prisma.emailToken.updateMany({ where: { userId, purpose: 'DISCORD_LINK', consumedAt: null }, data: { consumedAt: now } });
    await this.prisma.emailToken.create({ data: { userId, purpose: 'DISCORD_LINK', tokenHash: sha256(state), expiresAt: new Date(now.getTime() + STATE_TTL_MS) } });
    const q = new URLSearchParams({ client_id: this.env.DISCORD_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'identify', state, prompt: 'consent' });
    return { url: `${DISCORD}/oauth2/authorize?${q}` };
  }

  /** The signed-in app hands over Discord's answer. The state must belong to this same account. */
  async complete(userId: string, code: string, state: string, now = new Date()): Promise<{ username: string }> {
    if (!this.configured) throw new ServiceUnavailableException('Discord linking isn’t set up on this server yet.');
    const token = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(state) } });
    if (!token || token.purpose !== 'DISCORD_LINK' || token.consumedAt || token.expiresAt < now) {
      throw new UnprocessableEntityException('This Discord link has expired. Click “Connect Discord” again.');
    }
    if (token.userId !== userId) throw new ForbiddenException('This Discord link was started from another DelyForge account.');
    const claimed = await this.prisma.emailToken.updateMany({ where: { id: token.id, consumedAt: null }, data: { consumedAt: now } });
    if (!claimed.count) throw new UnprocessableEntityException('This Discord link was already used.');

    let discordUser: z.infer<typeof userSchema>;
    try {
      const res = await this.fetchImpl(`${DISCORD}/api/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.env.DISCORD_CLIENT_ID, client_secret: this.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new UnprocessableEntityException('Discord didn’t accept the sign-in. Please try again.');
      const { access_token } = tokenSchema.parse(await res.json());
      const me = await this.fetchImpl(`${DISCORD}/api/users/@me`, { headers: { authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10_000) });
      if (!me.ok) throw new UnprocessableEntityException('Discord didn’t share your account. Please try again.');
      discordUser = userSchema.parse(await me.json());
    } catch (e) {
      if (e instanceof UnprocessableEntityException) throw e;
      this.logger.warn(`Discord link failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Couldn’t reach Discord. Please try again in a minute.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.status !== 'ACTIVE') throw new ForbiddenException('This DelyForge account can’t be linked right now.');
    if (await this.prisma.ban.findUnique({ where: { kind_value: { kind: 'DISCORD', value: discordUser.id } } })) {
      await this.prisma.auditLog.create({ data: { actorId: userId, action: 'discord.link_blocked_banned', metadata: { discordId: discordUser.id } } });
      throw new ForbiddenException('This Discord account can’t be used with DelyForge.');
    }
    const other = await this.prisma.user.findUnique({ where: { discordId: discordUser.id } });
    if (other && other.id !== userId) throw new ForbiddenException('This Discord account is already linked to another DelyForge account.');

    const username = discordUser.global_name || discordUser.username;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        discordId: discordUser.id,
        discordUsername: username,
        discordAvatarUrl: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128` : null,
        discordLinkedAt: now,
      },
    });
    await this.prisma.auditLog.create({ data: { actorId: userId, action: 'discord.linked', metadata: { discordId: discordUser.id } } });
    return { username };
  }
}
