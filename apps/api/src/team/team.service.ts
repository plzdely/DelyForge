import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type PendingInvite, type TeamInfo, type TeamRole, lowestPlanWithFeature } from '@delyforge/shared';
import { BillingService } from '../billing/billing.service';
import { MAILER, type Mailer } from '../mail/mailer';
import { PrismaService } from '../prisma/prisma.service';

const INVITE_TTL_MS = 7 * 86_400_000;
const MANAGERS: TeamRole[] = ['OWNER', 'ADMIN'];

/**
 * Team workspaces (Business plan). Members share the workspace's plan and AI credits. Bots still live on each
 * person's computer — sharing bots needs cloud sync, which isn't built yet.
 */
@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  private async membership(userId: string, workspaceId: string) {
    const m = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (!m) throw new ForbiddenException('You’re not a member of this workspace.');
    return m;
  }

  private async requireManager(userId: string, workspaceId: string) {
    const m = await this.membership(userId, workspaceId);
    if (!MANAGERS.includes(m.role)) throw new ForbiddenException('Only the workspace owner or an admin can do that.');
    return m;
  }

  async info(userId: string, workspaceId: string, now = new Date()): Promise<TeamInfo> {
    const me = await this.membership(userId, workspaceId);
    const [ws, members, invites, mine, { claims }] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      this.prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: true }, orderBy: { joinedAt: 'asc' } }),
      this.prisma.workspaceInvite.findMany({ where: { workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.workspaceMember.findMany({ where: { userId }, include: { workspace: true }, orderBy: { joinedAt: 'asc' } }),
      this.billing.entitlements(userId, workspaceId, now),
    ]);
    return {
      workspace: { id: ws.id, name: ws.name, isPersonal: ws.isPersonal },
      myRole: me.role,
      canManage: MANAGERS.includes(me.role),
      members: members.map((m) => ({ userId: m.userId, displayName: m.user.displayName, email: m.user.email, role: m.role, joinedAt: m.joinedAt.toISOString() })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() })),
      seats: { used: members.length + invites.length, limit: claims.limits.maxTeamMembers },
      workspaces: mine.map((m) => ({ id: m.workspaceId, name: m.workspace.name, role: m.role, active: m.workspaceId === workspaceId })),
    };
  }

  private async assertSeat(userId: string, workspaceId: string, now: Date): Promise<void> {
    const { claims } = await this.billing.entitlements(userId, workspaceId, now);
    if (!claims.features.includes('team.workspaces')) {
      throw new ForbiddenException(`Team workspaces are available on the ${lowestPlanWithFeature('team.workspaces')?.name ?? 'Business'} plan.`);
    }
    const limit = claims.limits.maxTeamMembers;
    if (limit === null) return;
    const [members, invites] = await Promise.all([
      this.prisma.workspaceMember.count({ where: { workspaceId } }),
      this.prisma.workspaceInvite.count({ where: { workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } }),
    ]);
    if (members + invites >= limit) throw new ForbiddenException(`Your plan includes ${limit} team members (pending invites count). Remove someone or upgrade.`);
  }

  async invite(userId: string, workspaceId: string, email: string, role: Exclude<TeamRole, 'OWNER'>, now = new Date()): Promise<void> {
    await this.requireManager(userId, workspaceId);
    const existing = await this.prisma.workspaceMember.findFirst({ where: { workspaceId, user: { email } } });
    if (existing) throw new ConflictException('That person is already in this workspace.');
    // A new invite replaces an older one to the same address, so it doesn't use two seats.
    await this.prisma.workspaceInvite.updateMany({ where: { workspaceId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await this.assertSeat(userId, workspaceId, now);
    const [ws, inviter] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    // Accepting happens inside the app (matched to the signed-in, verified email), so the token is never sent.
    const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    await this.prisma.workspaceInvite.create({ data: { workspaceId, email, role, tokenHash, invitedById: userId, expiresAt: new Date(now.getTime() + INVITE_TTL_MS) } });
    await this.prisma.auditLog.create({ data: { actorId: userId, workspaceId, action: 'team.invited', metadata: { email, role } } });
    await this.mailer
      .send({
        to: email,
        subject: `${inviter.displayName} invited you to “${ws.name}” on DelyForge`,
        text: `${inviter.displayName} invited you to join the “${ws.name}” workspace on DelyForge.\n\nTo accept, open DelyForge, sign in (or create an account) with this email address, then go to Team. The invite is valid for 7 days.`,
      })
      .catch((e: Error) => this.logger.error(`Invite email not sent: ${e.message}`));
  }

  async revokeInvite(userId: string, workspaceId: string, inviteId: string): Promise<void> {
    await this.requireManager(userId, workspaceId);
    const r = await this.prisma.workspaceInvite.updateMany({ where: { id: inviteId, workspaceId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException('That invite doesn’t exist.');
  }

  /** Managers remove others; anyone except the owner can leave. */
  async removeMember(userId: string, workspaceId: string, targetUserId: string): Promise<void> {
    const target = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: targetUserId } } });
    if (!target) throw new NotFoundException('That person isn’t in this workspace.');
    if (target.role === 'OWNER') throw new BadRequestException('The owner can’t be removed.');
    if (targetUserId !== userId) await this.requireManager(userId, workspaceId);
    // Their requests for this workspace are refused at once (AuthGuard checks membership). A plan certificate already
    // on their computer stays valid until it expires (≤24 h) — the same offline window every plan change has.
    await this.prisma.workspaceMember.delete({ where: { id: target.id } });
    await this.prisma.auditLog.create({ data: { actorId: userId, workspaceId, action: targetUserId === userId ? 'team.left' : 'team.removed', metadata: { userId: targetUserId } } });
  }

  private async verifiedEmail(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.emailVerifiedAt) throw new ForbiddenException('Confirm your email address first (Account page).');
    return user.email;
  }

  async myInvites(userId: string, now = new Date()): Promise<PendingInvite[]> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.emailVerifiedAt) return [];
    const rows = await this.prisma.workspaceInvite.findMany({
      where: { email: user.email, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      include: { workspace: true },
      orderBy: { createdAt: 'desc' },
    });
    const inviters = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.invitedById) } } });
    return rows.map((r) => ({
      id: r.id,
      workspaceName: r.workspace.name,
      invitedBy: inviters.find((u) => u.id === r.invitedById)?.displayName ?? 'Someone',
      role: r.role,
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  /** Joins the workspace. Returns its ID so the app can switch to it. */
  async accept(userId: string, inviteId: string, now = new Date()): Promise<{ workspaceId: string }> {
    const email = await this.verifiedEmail(userId);
    const invite = await this.prisma.workspaceInvite.findFirst({ where: { id: inviteId, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } });
    if (!invite) throw new NotFoundException('That invite has expired or was withdrawn.');
    await this.prisma.$transaction(async (tx) => {
      // Single use: only one accept can flip acceptedAt.
      const claimed = await tx.workspaceInvite.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: now } });
      if (!claimed.count) throw new NotFoundException('That invite was already used.');
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
        create: { workspaceId: invite.workspaceId, userId, role: invite.role },
        update: {},
      });
      await tx.auditLog.create({ data: { actorId: userId, workspaceId: invite.workspaceId, action: 'team.joined', metadata: { role: invite.role } } });
    });
    return { workspaceId: invite.workspaceId };
  }
}
