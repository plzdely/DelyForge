import { createHash, sign } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  type ListingDetail,
  type ListingSummary,
  type ListingType,
  type MyListing,
  type PackageContent,
  type PackagePayload,
  type ReviewQueueItem,
  type SignedPackage,
  base64UrlEncode,
  lowestPlanWithFeature,
  packageSigningInput,
  validatePackage,
} from '@delyforge/shared';
import type { z } from 'zod';
import type { developerProfileSchema, reviewSchema, submitListingSchema } from '@delyforge/shared';
import { type EntitlementKeys } from '../auth/crypto';
import { BillingService, ENTITLEMENT_KEYS } from '../billing/billing.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const published = { status: 'PUBLISHED' as const, versions: { some: { reviewStatus: 'APPROVED' as const } } };
const latestApproved = { where: { reviewStatus: 'APPROVED' as const }, orderBy: { createdAt: 'desc' as const }, take: 1 };

type ListingRow = Prisma.ListingGetPayload<{ include: { developer: true; versions: true } }>;

function summary(l: ListingRow): ListingSummary {
  return {
    slug: l.slug,
    type: l.type as ListingType,
    title: l.title,
    summary: l.summary,
    category: l.category,
    tags: l.tags,
    developer: l.developer.displayName,
    ratingAvg: l.ratingAvg,
    ratingCount: l.ratingCount,
    downloads: l.downloads,
    version: l.versions[0]?.version ?? '',
    updatedAt: l.updatedAt.toISOString(),
  };
}

/**
 * Marketplace: community content packs (declarative only). Every version is reviewed by DelyForge staff and signed
 * with the DelyForge key; the app refuses packs whose signature doesn't verify.
 * Paid listings are not supported yet (they need Stripe Connect payouts), so every listing is free.
 */
@Injectable()
export class MarketplaceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(ENTITLEMENT_KEYS) private readonly keys: EntitlementKeys,
  ) {}

  async list(filter: { type?: ListingType; q?: string; sort?: 'popular' | 'rating' | 'new' }): Promise<ListingSummary[]> {
    const rows = await this.prisma.listing.findMany({
      where: {
        ...published,
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.q ? { OR: [{ title: { contains: filter.q, mode: 'insensitive' } }, { summary: { contains: filter.q, mode: 'insensitive' } }, { tags: { has: filter.q.toLowerCase() } }] } : {}),
      },
      include: { developer: true, versions: latestApproved },
      orderBy: filter.sort === 'rating' ? { ratingAvg: 'desc' } : filter.sort === 'new' ? { createdAt: 'desc' } : { downloads: 'desc' },
      take: 100,
    });
    return rows.map(summary);
  }

  async detail(slug: string): Promise<ListingDetail> {
    const l = await this.prisma.listing.findFirst({
      where: { slug, ...published },
      include: { developer: true, versions: latestApproved, reviews: { where: { hidden: false }, include: { user: true }, orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!l) throw new NotFoundException('That listing doesn’t exist.');
    const content = l.versions[0]!.content as unknown as PackageContent;
    return {
      ...summary(l),
      description: l.description,
      changelog: l.versions[0]!.changelog,
      contents: {
        modules: Object.keys(content.modules),
        commands: content.commands.map((c) => (c.type === 'slash' ? `/${c.name}` : c.name)),
        embeds: content.embeds.length,
        workflows: content.workflows.map((w) => w.name),
      },
      reviews: l.reviews.map((r) => ({ rating: r.rating, body: r.body, author: r.user.displayName, createdAt: r.createdAt.toISOString() })),
    };
  }

  private payloadFor(l: { slug: string; title: string }, v: { version: string; content: unknown }): string {
    const payload: PackagePayload = { slug: l.slug, title: l.title, version: v.version, content: v.content as PackageContent };
    return JSON.stringify(payload);
  }

  async install(userId: string, workspaceId: string, slug: string): Promise<SignedPackage> {
    const { claims } = await this.billing.entitlements(userId, workspaceId);
    if (!claims.features.includes('marketplace.access')) {
      throw new ForbiddenException(`The marketplace is available on the ${lowestPlanWithFeature('marketplace.access')?.name ?? 'Pro'} plan.`);
    }
    const l = await this.prisma.listing.findFirst({ where: { slug, ...published }, include: { versions: latestApproved } });
    const v = l?.versions[0];
    if (!l || !v?.signature) throw new NotFoundException('That listing doesn’t exist.');
    const payload = this.payloadFor(l, v);
    // The stored hash pins exactly what staff approved; anything else is refused rather than re-signed.
    if (sha256(payload) !== v.packageSha256) throw new ConflictException('This package changed after review and can’t be installed.');
    const existing = await this.prisma.purchase.findUnique({ where: { userId_listingId: { userId, listingId: l.id } } });
    if (!existing) {
      await this.prisma.$transaction([
        this.prisma.purchase.create({ data: { userId, listingId: l.id, amountCents: 0, platformFeeCents: 0 } }),
        this.prisma.listing.update({ where: { id: l.id }, data: { downloads: { increment: 1 } } }),
      ]);
    }
    return { payload, signature: v.signature };
  }

  async review(userId: string, slug: string, input: z.infer<typeof reviewSchema>): Promise<void> {
    const l = await this.prisma.listing.findFirst({ where: { slug, ...published } });
    if (!l) throw new NotFoundException('That listing doesn’t exist.');
    if (!(await this.prisma.purchase.findUnique({ where: { userId_listingId: { userId, listingId: l.id } } }))) {
      throw new ForbiddenException('Install it first, then you can leave a review.');
    }
    const data = { rating: input.rating, body: input.body || null };
    await this.prisma.review.upsert({ where: { userId_listingId: { userId, listingId: l.id } }, create: { userId, listingId: l.id, ...data }, update: data });
    const agg = await this.prisma.review.aggregate({ where: { listingId: l.id, hidden: false }, _avg: { rating: true }, _count: true });
    await this.prisma.listing.update({ where: { id: l.id }, data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count } });
  }

  // ─── Developers ──────────────────────────────────────────────────────────────────────────────────────────────────

  async becomeDeveloper(userId: string, input: z.infer<typeof developerProfileSchema>): Promise<{ displayName: string; slug: string }> {
    if (await this.prisma.developerProfile.findUnique({ where: { userId } })) throw new ConflictException('You already have a developer profile.');
    if (await this.prisma.developerProfile.findUnique({ where: { slug: input.slug } })) throw new ConflictException('That profile address is taken.');
    const p = await this.prisma.developerProfile.create({ data: { userId, ...input } });
    return { displayName: p.displayName, slug: p.slug };
  }

  async developer(userId: string): Promise<{ displayName: string; slug: string } | null> {
    const p = await this.prisma.developerProfile.findUnique({ where: { userId } });
    return p ? { displayName: p.displayName, slug: p.slug } : null;
  }

  /** Submits a new listing, or a new version of the developer's own listing. Both wait for review. */
  async submit(userId: string, input: z.infer<typeof submitListingSchema>): Promise<MyListing> {
    const dev = await this.prisma.developerProfile.findUnique({ where: { userId } });
    if (!dev) throw new ForbiddenException('Create a developer profile first.');
    const checked = validatePackage(input.content);
    if (!checked.ok) throw new UnprocessableEntityException(checked.error);
    const content = checked.content as unknown as Prisma.InputJsonValue;
    const version = { version: input.version, changelog: input.changelog || null, manifest: { type: input.type }, minAppVersion: '0.1.0', content, packageSha256: '' };

    const existing = await this.prisma.listing.findUnique({ where: { slug: input.slug }, include: { versions: true } });
    if (existing && existing.developerId !== dev.id) throw new ConflictException('That listing address is taken.');
    // Only staff can lift a suspension; new versions must not put a suspended listing back into review.
    if (existing?.status === 'SUSPENDED') throw new ForbiddenException('This listing is suspended. Contact DelyForge support.');
    if (existing) {
      if (existing.type !== input.type) throw new UnprocessableEntityException('A listing’s type can’t change.');
      if (existing.versions.some((v) => v.version === input.version)) throw new ConflictException(`Version ${input.version} was already submitted.`);
      await this.prisma.listingVersion.create({ data: { listingId: existing.id, ...version } });
      if (existing.status !== 'PUBLISHED') await this.prisma.listing.update({ where: { id: existing.id }, data: { status: 'IN_REVIEW' } });
    } else {
      await this.prisma.listing.create({
        data: {
          developerId: dev.id,
          type: input.type,
          slug: input.slug,
          title: input.title,
          summary: input.summary,
          description: input.description,
          category: input.category,
          tags: input.tags.map((t) => t.toLowerCase()),
          status: 'IN_REVIEW',
          versions: { create: version },
        },
      });
    }
    return (await this.mine(userId)).find((l) => l.slug === input.slug)!;
  }

  async mine(userId: string): Promise<MyListing[]> {
    const rows = await this.prisma.listing.findMany({
      where: { developer: { userId } },
      include: { versions: { orderBy: { createdAt: 'desc' } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((l) => ({
      slug: l.slug,
      title: l.title,
      status: l.status,
      versions: l.versions.map((v) => ({ version: v.version, reviewStatus: v.reviewStatus, reviewNotes: v.reviewNotes, createdAt: v.createdAt.toISOString() })),
    }));
  }

  // ─── Staff review ────────────────────────────────────────────────────────────────────────────────────────────────

  private async requireStaff(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role !== 'ADMIN' && user?.role !== 'SUPPORT') throw new ForbiddenException('Staff only.');
  }

  async queue(userId: string): Promise<ReviewQueueItem[]> {
    await this.requireStaff(userId);
    const rows = await this.prisma.listingVersion.findMany({
      where: { reviewStatus: 'PENDING', listing: { status: { not: 'SUSPENDED' } } },
      include: { listing: { include: { developer: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return rows.map((v) => ({
      versionId: v.id,
      slug: v.listing.slug,
      title: v.listing.title,
      type: v.listing.type as ListingType,
      version: v.version,
      developer: v.listing.developer.displayName,
      submittedAt: v.createdAt.toISOString(),
      content: v.content as unknown as PackageContent,
    }));
  }

  /** Approving signs the exact package text with the DelyForge key; rejecting records the reason for the developer. */
  async moderate(userId: string, versionId: string, approve: boolean, notes: string): Promise<void> {
    await this.requireStaff(userId);
    const v = await this.prisma.listingVersion.findUnique({ where: { id: versionId }, include: { listing: { include: { versions: true } } } });
    if (!v || v.reviewStatus !== 'PENDING') throw new NotFoundException('That version isn’t waiting for review.');
    if (approve && v.listing.status === 'SUSPENDED') throw new ForbiddenException('This listing is suspended; lift the suspension first.');
    // Re-check with today's rules: the schemas may have tightened since it was submitted.
    const checked = validatePackage(v.content);
    if (approve && !checked.ok) throw new UnprocessableEntityException(`Can’t approve: ${checked.error}`);
    const reviewed = { reviewNotes: notes || null, reviewedById: userId, reviewedAt: new Date() };
    if (approve) {
      const payload = this.payloadFor(v.listing, v);
      const signature = base64UrlEncode(sign(null, Buffer.from(packageSigningInput(payload)), this.keys.privateKey));
      await this.prisma.$transaction([
        this.prisma.listingVersion.update({ where: { id: v.id }, data: { ...reviewed, reviewStatus: 'APPROVED', signature, packageSha256: sha256(payload) } }),
        this.prisma.listing.update({ where: { id: v.listingId }, data: { status: 'PUBLISHED' } }),
      ]);
    } else {
      const hasApproved = v.listing.versions.some((x) => x.reviewStatus === 'APPROVED');
      await this.prisma.$transaction([
        this.prisma.listingVersion.update({ where: { id: v.id }, data: { ...reviewed, reviewStatus: 'REJECTED' } }),
        ...(hasApproved ? [] : [this.prisma.listing.update({ where: { id: v.listingId }, data: { status: 'REJECTED' } })]),
      ]);
    }
    await this.prisma.auditLog.create({ data: { actorId: userId, action: approve ? 'marketplace.version_approved' : 'marketplace.version_rejected', metadata: { versionId, slug: v.listing.slug } } });
  }
}
