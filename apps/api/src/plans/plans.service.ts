import { Inject, Injectable } from '@nestjs/common';
import type { FeatureKey, PlanLimits } from '@delyforge/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicPlan {
  id: string;
  name: string;
  tagline: string;
  rank: number;
  limits: PlanLimits;
  features: FeatureKey[];
  highlights: string[];
  prices: { interval: 'month' | 'year'; amountCents: number; currency: string }[];
  customPricing: boolean;
}

@Injectable()
export class PlansService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Public plan catalogue, read from the database (admin-editable), ordered by rank. */
  async listPublic(): Promise<PublicPlan[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isPublic: true },
      include: { prices: { where: { active: true } } },
      orderBy: { rank: 'asc' },
    });

    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      rank: p.rank,
      limits: p.limits as unknown as PlanLimits,
      features: p.features as unknown as FeatureKey[],
      highlights: p.highlights as unknown as string[],
      prices: p.prices.map((pr) => ({
        interval: pr.interval === 'YEAR' ? ('year' as const) : ('month' as const),
        amountCents: pr.amountCents,
        currency: pr.currency,
      })),
      customPricing: p.prices.length === 0,
    }));
  }
}
