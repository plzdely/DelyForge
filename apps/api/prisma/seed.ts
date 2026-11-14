/**
 * Seeds the plan catalogue from @delyforge/shared. Safe to run repeatedly (upserts).
 * Run with: pnpm db:seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEFAULT_PLANS } from '@delyforge/shared';
import { PrismaClient } from '../src/generated/prisma/client';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set (see apps/api/.env.example)');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    for (const plan of Object.values(DEFAULT_PLANS)) {
      await prisma.plan.upsert({
        where: { id: plan.id },
        create: {
          id: plan.id,
          name: plan.name,
          tagline: plan.tagline,
          rank: plan.rank,
          limits: { ...plan.limits },
          features: [...plan.features],
          highlights: [...plan.highlights],
        },
        update: {
          name: plan.name,
          tagline: plan.tagline,
          rank: plan.rank,
          limits: { ...plan.limits },
          features: [...plan.features],
          highlights: [...plan.highlights],
        },
      });

      if (plan.pricing) {
        for (const [interval, amountCents] of [
          ['MONTH', plan.pricing.monthlyUsdCents],
          ['YEAR', plan.pricing.annualUsdCents],
        ] as const) {
          const existing = await prisma.planPrice.findFirst({
            where: { planId: plan.id, interval, currency: 'usd', active: true },
          });
          if (existing) {
            await prisma.planPrice.update({ where: { id: existing.id }, data: { amountCents } });
          } else {
            await prisma.planPrice.create({ data: { planId: plan.id, interval, amountCents, currency: 'usd' } });
          }
        }
      }
    }
    console.log(`Seeded ${Object.keys(DEFAULT_PLANS).length} plans.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
