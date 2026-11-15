import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type AdminAuditEntry, type AdminOverview, type AdminUser, PLAN_IDS, type PlanId, type adminOverrideSchema } from '@delyforge/shared';
import type { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';

type Level = 'support' | 'admin';

/** Staff tools. SUPPORT can read; ADMIN can change. Every change goes to the audit log. */
@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Checks the role in the database on every call (not from the token), so demotions apply immediately. */
  async require(userId: string, level: Level): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const ok = user?.status === 'ACTIVE' && (user.role === 'ADMIN' || (level === 'support' && user.role === 'SUPPORT'));
    if (!ok) throw new ForbiddenException('Staff only.');
  }

  private audit(actorId: string, action: string, target: { type: string; id: string }, metadata: object, workspaceId?: string) {
    return this.prisma.auditLog.create({ data: { actorId, action, targetType: target.type, targetId: target.id, metadata, workspaceId } });
  }

  async overview(now = new Date()): Promise<AdminOverview> {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [users, newUsers7d, subs, ai, pendingReviews, publishedListings] = await Promise.all([
      this.prisma.user.count({ where: { status: { not: 'DELETED' } } }),
      this.prisma.user.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } }),
      this.prisma.subscription.groupBy({ by: ['planId'], where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } }, _count: true }),
      this.prisma.aiUsage.aggregate({ where: { createdAt: { gte: month } }, _sum: { credits: true, costMicroCents: true } }),
      this.prisma.listingVersion.count({ where: { reviewStatus: 'PENDING' } }),
      this.prisma.listing.count({ where: { status: 'PUBLISHED' } }),
    ]);
    const subscriptions = Object.fromEntries(PLAN_IDS.map((p) => [p, subs.find((s) => s.planId === p)?._count ?? 0])) as Record<PlanId, number>;
    return {
      users,
      newUsers7d,
      subscriptions,
      aiCreditsThisMonth: ai._sum.credits ?? 0,
      aiCostCentsThisMonth: Math.round((ai._sum.costMicroCents ?? 0) / 100),
      pendingReviews,
      publishedListings,
    };
  }

  async users(q: string): Promise<AdminUser[]> {
    const rows = await this.prisma.user.findMany({
      where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }, { id: q }] } : {},
      include: { ownedWorkspaces: { where: { isPersonal: true }, include: { subscription: true, entitlementOverrides: { orderBy: { createdAt: 'desc' } } } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((u) => {
      const ws = u.ownedWorkspaces[0];
      return {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        status: u.status,
        emailVerified: u.emailVerifiedAt !== null,
        createdAt: u.createdAt.toISOString(),
        workspace: { id: ws?.id ?? '', name: ws?.name ?? '', planId: ws?.subscription?.planId ?? 'free', subscriptionStatus: ws?.subscription?.status ?? null },
        overrides: (ws?.entitlementOverrides ?? []).map((o) => ({
          id: o.id,
          grantFeatures: o.grantFeatures as string[],
          limits: o.limits as Record<string, number | null>,
          reason: o.reason,
          expiresAt: o.expiresAt?.toISOString() ?? null,
        })),
      };
    });
  }

  /** Suspending signs the person out everywhere; sign-in and refresh already refuse suspended accounts. */
  async setUserStatus(actorId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string): Promise<void> {
    if (actorId === userId) throw new BadRequestException('You can’t change your own account status.');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === 'DELETED') throw new NotFoundException('That user doesn’t exist.');
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
    if (status === 'SUSPENDED') await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit(actorId, `admin.user_${status.toLowerCase()}`, { type: 'user', id: userId }, { reason });
  }

  async grantOverride(actorId: string, workspaceId: string, input: z.infer<typeof adminOverrideSchema>): Promise<void> {
    if (!(await this.prisma.workspace.findUnique({ where: { id: workspaceId } }))) throw new NotFoundException('That workspace doesn’t exist.');
    const o = await this.prisma.entitlementOverride.create({
      data: { workspaceId, grantFeatures: input.grantFeatures, limits: input.limits, reason: input.reason, grantedById: actorId, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null },
    });
    await this.audit(actorId, 'admin.override_granted', { type: 'override', id: o.id }, { ...input }, workspaceId);
  }

  async revokeOverride(actorId: string, overrideId: string): Promise<void> {
    const o = await this.prisma.entitlementOverride.findUnique({ where: { id: overrideId } });
    if (!o) throw new NotFoundException('That override doesn’t exist.');
    await this.prisma.entitlementOverride.delete({ where: { id: overrideId } });
    await this.audit(actorId, 'admin.override_revoked', { type: 'override', id: overrideId }, { reason: o.reason }, o.workspaceId);
  }

  async setListingStatus(actorId: string, slug: string, status: 'PUBLISHED' | 'SUSPENDED', reason: string): Promise<void> {
    const l = await this.prisma.listing.findUnique({ where: { slug }, include: { versions: { where: { reviewStatus: 'APPROVED' } } } });
    if (!l) throw new NotFoundException('That listing doesn’t exist.');
    if (status === 'PUBLISHED' && !l.versions.length) throw new BadRequestException('It has no approved version to publish.');
    await this.prisma.listing.update({ where: { id: l.id }, data: { status } });
    await this.audit(actorId, `admin.listing_${status.toLowerCase()}`, { type: 'listing', id: l.id }, { slug, reason });
  }

  async setReviewHidden(actorId: string, reviewId: string, hidden: boolean): Promise<void> {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!r) throw new NotFoundException('That review doesn’t exist.');
    await this.prisma.review.update({ where: { id: reviewId }, data: { hidden } });
    const agg = await this.prisma.review.aggregate({ where: { listingId: r.listingId, hidden: false }, _avg: { rating: true }, _count: true });
    await this.prisma.listing.update({ where: { id: r.listingId }, data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count } });
    await this.audit(actorId, hidden ? 'admin.review_hidden' : 'admin.review_shown', { type: 'review', id: reviewId }, {});
  }

  async auditLog(limit = 200): Promise<AdminAuditEntry[]> {
    const rows = await this.prisma.auditLog.findMany({ include: { actor: true }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 500) });
    return rows.map((r) => ({ id: r.id, action: r.action, actor: r.actor?.email ?? null, workspaceId: r.workspaceId, metadata: r.metadata, createdAt: r.createdAt.toISOString() }));
  }
}
