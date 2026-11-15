import { ConflictException, ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { AccountProfile, AuthTokens, SessionInfo } from '@delyforge/shared';
import { ENV, type Env } from '../config/env';
import { MAILER, type Mailer } from '../mail/mailer';
import { PrismaService } from '../prisma/prisma.service';
import { DUMMY_HASH_PROMISE, hashPassword, randomToken, sha256, signAccessToken, verifyPassword } from './crypto';

const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;
const EMAIL_TOKEN_TTL_MS = { VERIFY_EMAIL: 48 * 3600 * 1000, RESET_PASSWORD: 3600 * 1000 } as const;

/**
 * Accounts and sessions. Passwords are hashed with scrypt; refresh tokens and email tokens are stored only as SHA-256
 * hashes. Refresh tokens rotate on every use, and reusing an old one revokes the whole session (theft detection).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async register(input: { email: string; password: string; displayName: string }, meta: { deviceName?: string; userAgent?: string; ip?: string }): Promise<AuthTokens> {
    if (await this.prisma.ban.findUnique({ where: { kind_value: { kind: 'EMAIL', value: input.email } } })) {
      throw new ForbiddenException('This email address can’t be used for DelyForge.');
    }
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('An account with this email already exists. Sign in instead.');
    const passwordHash = await hashPassword(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email: input.email, passwordHash, displayName: input.displayName } });
      // Every account gets a personal workspace — that's where its subscription lives.
      const ws = await tx.workspace.create({
        data: { name: `${input.displayName}’s workspace`, slug: `ws-${randomToken(9).toLowerCase()}`, isPersonal: true, ownerId: u.id },
      });
      await tx.workspaceMember.create({ data: { workspaceId: ws.id, userId: u.id, role: 'OWNER' } });
      await tx.auditLog.create({ data: { actorId: u.id, workspaceId: ws.id, action: 'account.registered', ipAddress: meta.ip } });
      return u;
    });
    await this.sendVerificationEmail(user.id, user.email);
    return this.createSession(user.id, meta);
  }

  async login(input: { email: string; password: string; deviceName?: string }, meta: { userAgent?: string; ip?: string }): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Same work whether or not the account exists, so response time doesn't reveal registered emails.
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await DUMMY_HASH_PROMISE));
    if (!user || !ok) throw new UnauthorizedException('Email or password is incorrect.');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('This account is suspended. Contact support.');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorId: user.id, action: 'account.login', ipAddress: meta.ip, metadata: { device: input.deviceName ?? null } } });
    return this.createSession(user.id, { ...meta, deviceName: input.deviceName });
  }

  private async createSession(
    userId: string,
    meta: { deviceName?: string; userAgent?: string; ip?: string },
    familyId = randomToken(12),
    workspaceId: string | null = null,
  ): Promise<AuthTokens> {
    // The device's active workspace (a team it belongs to), or the personal one. Membership is re-checked every time.
    const ws = (workspaceId && (await this.memberWorkspace(userId, workspaceId))) || (await this.personalWorkspace(userId));
    const refreshToken = randomToken(32);
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: sha256(refreshToken),
        familyId,
        deviceName: meta.deviceName?.slice(0, 80),
        userAgent: meta.userAgent?.slice(0, 300),
        ipAddress: meta.ip,
        workspaceId: ws.id,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    const access = signAccessToken({ sub: userId, sid: session.id, ws: ws.id }, this.env.JWT_SECRET);
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken };
  }

  /** Exchanges a refresh token for new tokens. The old refresh token stops working. */
  async refresh(refreshToken: string, meta: { userAgent?: string; ip?: string }): Promise<AuthTokens> {
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha256(refreshToken) } });
    if (!session || session.expiresAt < new Date()) throw new UnauthorizedException('Your session has expired. Please sign in again.');
    if (session.revokedAt) {
      // A rotated token was used again: it was probably stolen. Sign out every session in this family.
      await this.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.prisma.auditLog.create({ data: { actorId: session.userId, action: 'security.refresh_token_reuse', ipAddress: meta.ip } });
      this.logger.warn(`Refresh token reuse detected for user ${session.userId}; session family revoked.`);
      throw new UnauthorizedException('Your session was signed out for security. Please sign in again.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('This account is not available.');
    // Revoke-then-create: only one caller can rotate a given token.
    const rotated = await this.prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (rotated.count !== 1) throw new UnauthorizedException('Your session has expired. Please sign in again.');
    return this.createSession(session.userId, { deviceName: session.deviceName ?? undefined, userAgent: meta.userAgent, ip: meta.ip }, session.familyId, session.workspaceId);
  }

  /** Makes another workspace (personal or a team the user belongs to) active on this device. Rotates the tokens. */
  async switchWorkspace(userId: string, sessionId: string, workspaceId: string, meta: { userAgent?: string; ip?: string }): Promise<AuthTokens> {
    if (!(await this.memberWorkspace(userId, workspaceId))) throw new ForbiddenException('You’re not a member of that workspace.');
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new UnauthorizedException('Please sign in again.');
    await this.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    return this.createSession(userId, { deviceName: session.deviceName ?? undefined, userAgent: meta.userAgent, ip: meta.ip }, session.familyId, workspaceId);
  }

  async isMember(userId: string, workspaceId: string): Promise<boolean> {
    return (await this.memberWorkspace(userId, workspaceId)) !== null;
  }

  private async memberWorkspace(userId: string, workspaceId: string) {
    const m = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, include: { workspace: true } });
    return m?.workspace ?? null;
  }

  async logout(sessionId: string): Promise<void> {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (s) await this.prisma.session.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async sessions(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
    // One row per family (the newest token in each), i.e. per signed-in device.
    const rows = await this.prisma.session.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    const current = await this.prisma.session.findUnique({ where: { id: currentSessionId } });
    return rows.map((r) => ({
      id: r.id,
      deviceName: r.deviceName,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
      current: r.familyId === current?.familyId,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!s || s.userId !== userId) return;
    await this.prisma.session.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** True while the session behind an access token is still valid (sign-out takes effect immediately). */
  async sessionActive(sessionId: string): Promise<boolean> {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!s || s.expiresAt < new Date()) return false;
    if (!s.revokedAt) return true;
    // A rotated (not signed-out) session stays valid until its access token expires if its family is still active.
    const live = await this.prisma.session.count({ where: { familyId: s.familyId, revokedAt: null } });
    return live > 0;
  }

  async profile(userId: string, workspaceId?: string): Promise<AccountProfile> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ws = (workspaceId && (await this.memberWorkspace(userId, workspaceId))) || (await this.personalWorkspace(userId));
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      workspace: { id: ws.id, name: ws.name },
      discord: user.discordId ? { id: user.discordId, username: user.discordUsername ?? '', avatarUrl: user.discordAvatarUrl } : null,
    };
  }

  async updateProfile(userId: string, displayName: string, workspaceId?: string): Promise<AccountProfile> {
    await this.prisma.user.update({ where: { id: userId }, data: { displayName } });
    return this.profile(userId, workspaceId);
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(current, user.passwordHash))) throw new UnauthorizedException('Your current password is incorrect.');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
    // Sign out every other device.
    const keep = await this.prisma.session.findUnique({ where: { id: sessionId } });
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null, NOT: { familyId: keep?.familyId ?? '' } }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorId: userId, action: 'account.password_changed' } });
  }

  // ─── Email verification & password reset ─────────────────────────────────────────────────────────────────────────

  private async createEmailToken(userId: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD'): Promise<string> {
    const token = randomToken(32);
    // Only the newest link of each kind works.
    await this.prisma.emailToken.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
    await this.prisma.emailToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS[purpose]) } });
    return token;
  }

  async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const token = await this.createEmailToken(userId, 'VERIFY_EMAIL');
    await this.mailer
      .send({
        to: email,
        subject: 'Confirm your DelyForge email',
        text: `Welcome to DelyForge!\n\nConfirm your email address by opening this link (valid for 48 hours):\n${this.env.PUBLIC_API_URL}/v1/auth/verify-email?token=${token}\n\nIf you didn’t create an account, you can ignore this email.`,
      })
      .catch((e: Error) => this.logger.error(`Verification email not sent: ${e.message}`));
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.emailVerifiedAt) await this.sendVerificationEmail(user.id, user.email);
  }

  private async consumeEmailToken(token: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD'): Promise<string | null> {
    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.purpose !== purpose || row.consumedAt || row.expiresAt < new Date()) return null;
    const used = await this.prisma.emailToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    return used.count === 1 ? row.userId : null;
  }

  async verifyEmail(token: string): Promise<boolean> {
    const userId = await this.consumeEmailToken(token, 'VERIFY_EMAIL');
    if (!userId) return false;
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    return true;
  }

  /** Always succeeds from the caller's point of view, so it can't be used to discover registered emails. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;
    const token = await this.createEmailToken(user.id, 'RESET_PASSWORD');
    await this.mailer
      .send({
        to: user.email,
        subject: 'Reset your DelyForge password',
        text: `Someone asked to reset your DelyForge password.\n\nOpen this link to choose a new one (valid for 1 hour):\n${this.env.PUBLIC_API_URL}/v1/auth/reset-password?token=${token}\n\nIf this wasn’t you, ignore this email — your password stays the same.`,
      })
      .catch((e: Error) => this.logger.error(`Reset email not sent: ${e.message}`));
  }

  async resetPassword(token: string, password: string): Promise<boolean> {
    const userId = await this.consumeEmailToken(token, 'RESET_PASSWORD');
    if (!userId) return false;
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
    // A reset signs out every device.
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorId: userId, action: 'account.password_reset' } });
    return true;
  }

  async personalWorkspace(userId: string) {
    return this.prisma.workspace.findFirstOrThrow({ where: { ownerId: userId, isPersonal: true } });
  }
}
