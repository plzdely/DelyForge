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
          // Stripe price IDs come from the environment (STRIPE_PRICE_PRO_MONTH, …) once products exist in Stripe.
          const stripePriceId = process.env[`STRIPE_PRICE_${plan.id.toUpperCase()}_${interval}`] || null;
          if (existing) {
            await prisma.planPrice.update({ where: { id: existing.id }, data: { amountCents, ...(stripePriceId ? { stripePriceId } : {}) } });
          } else {
            await prisma.planPrice.create({ data: { planId: plan.id, interval, amountCents, currency: 'usd', stripePriceId } });
          }
        }
      }
    }
    console.log(`Seeded ${Object.keys(DEFAULT_PLANS).length} plans.`);

    // AI model catalogue. Costs are Anthropic's list prices in cents per million tokens (used for our own reporting).
    await prisma.aiProvider.upsert({ where: { id: 'anthropic' }, create: { id: 'anthropic', name: 'Anthropic' }, update: {} });
    await prisma.aiModel.upsert({
      where: { providerId_modelKey: { providerId: 'anthropic', modelKey: 'claude-opus-5-5' } },
      create: {
        providerId: 'anthropic',
        modelKey: 'claude-opus-5-5',
        displayName: 'Claude Opus 5.5',
        inputCostPerMTokCents: 400,
        outputCostPerMTokCents: 2000,
        features: ['builder', 'troubleshoot'],
        isDefault: true,
      },
      update: {},
    });
    console.log('Seeded the AI model catalogue.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
