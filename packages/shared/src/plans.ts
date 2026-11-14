/**
 * Default plan catalogue.
 *
 * IMPORTANT: this is the *default/seed* catalogue. In production the authoritative plans, prices and limits live in the
 * cloud database (seeded from here) and can be changed by administrators without an app release. Clients must never
 * treat their local copy as proof of what a customer has paid for — see entitlements.ts and ARCHITECTURE.md §8.
 */

export const PLAN_IDS = ['free', 'pro', 'business', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const FEATURE_KEYS = [
  'modules.basic',
  'modules.standard',
  'moderation.advanced',
  'builder.commands',
  'builder.embeds',
  'automation.basic',
  'automation.advanced',
  'ai.builder',
  'ai.troubleshooting',
  'analytics.basic',
  'analytics.advanced',
  'templates.limited',
  'templates.standard',
  'templates.premium',
  'marketplace.access',
  'backups',
  'team.workspaces',
  'permissions.advanced',
  'monitoring.advanced',
  'remote.management',
  'integrations.advanced',
  'audit.logs',
  'organization.management',
  'support.community',
  'support.priority',
  'support.dedicated',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** `null` means "unlimited / negotiated" (subject to fair use). */
export interface PlanLimits {
  maxBotProjects: number | null;
  maxWorkflows: number | null;
  maxTeamMembers: number | null;
  /** Monthly AI credits. 1 credit ≈ one typical AI request. */
  aiCreditsPerMonth: number;
  logRetentionDays: number;
}

export interface PlanPricing {
  /** Prices in US cents. */
  monthlyUsdCents: number;
  annualUsdCents: number;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  /** `null` = custom pricing (contact sales). */
  pricing: PlanPricing | null;
  limits: PlanLimits;
  features: readonly FeatureKey[];
  /** Customer-facing bullet points for pricing pages. */
  highlights: readonly string[];
  /** Plan order, used for upgrade/downgrade comparisons. */
  rank: number;
}

const FREE_FEATURES = [
  'modules.basic',
  'builder.commands',
  'automation.basic',
  'analytics.basic',
  'templates.limited',
  'support.community',
] as const satisfies readonly FeatureKey[];

const PRO_FEATURES = [
  ...FREE_FEATURES.filter((f) => f !== 'support.community' && f !== 'templates.limited'),
  'modules.standard',
  'moderation.advanced',
  'builder.embeds',
  'ai.builder',
  'ai.troubleshooting',
  'analytics.advanced',
  'templates.standard',
  'marketplace.access',
  'backups',
  'support.priority',
] as const satisfies readonly FeatureKey[];

const BUSINESS_FEATURES = [
  ...PRO_FEATURES,
  'team.workspaces',
  'permissions.advanced',
  'automation.advanced',
  'monitoring.advanced',
  'remote.management',
  'templates.premium',
  'integrations.advanced',
] as const satisfies readonly FeatureKey[];

const ENTERPRISE_FEATURES = [
  ...BUSINESS_FEATURES.filter((f) => f !== 'support.priority'),
  'audit.logs',
  'organization.management',
  'support.dedicated',
] as const satisfies readonly FeatureKey[];

export const DEFAULT_PLANS: Readonly<Record<PlanId, PlanDefinition>> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Everything you need to launch your first bot.',
    pricing: { monthlyUsdCents: 0, annualUsdCents: 0 },
    limits: {
      maxBotProjects: 1,
      maxWorkflows: 3,
      maxTeamMembers: 1,
      aiCreditsPerMonth: 0,
      logRetentionDays: 3,
    },
    features: FREE_FEATURES,
    highlights: [
      '1 bot project',
      'Basic modules',
      'Local hosting',
      '3 automation workflows',
      'Basic analytics',
      'Limited templates',
      'Community support',
    ],
    rank: 0,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'For creators running serious communities.',
    // Annual = 10× monthly (two months free). Configurable server-side.
    pricing: { monthlyUsdCents: 999, annualUsdCents: 9990 },
    limits: {
      maxBotProjects: 5,
      maxWorkflows: null,
      maxTeamMembers: 1,
      aiCreditsPerMonth: 300,
      logRetentionDays: 14,
    },
    features: PRO_FEATURES,
    highlights: [
      'Up to 5 bot projects',
      'All standard modules',
      'Unlimited workflows (fair use)',
      'AI Bot Builder & troubleshooting',
      'Advanced analytics',
      'Custom embeds & advanced moderation',
      'Standard templates & marketplace',
      'Backups',
      'Priority support',
    ],
    rank: 1,
  },
  business: {
    id: 'business',
    name: 'Business',
    tagline: 'For teams managing many bots and servers.',
    pricing: { monthlyUsdCents: 2499, annualUsdCents: 24990 },
    limits: {
      maxBotProjects: 20,
      maxWorkflows: null,
      maxTeamMembers: 5,
      aiCreditsPerMonth: 1500,
      logRetentionDays: 30,
    },
    features: BUSINESS_FEATURES,
    highlights: [
      'Up to 20 bot projects',
      'Everything in Pro',
      '5 team members & shared workspaces',
      'Advanced permissions',
      'Enhanced AI allowance',
      'Advanced automation & monitoring',
      'Remote management',
      'Premium templates & advanced integrations',
    ],
    rank: 2,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Custom limits, deployment and support.',
    pricing: null,
    limits: {
      maxBotProjects: null,
      maxWorkflows: null,
      maxTeamMembers: null,
      aiCreditsPerMonth: 10000,
      logRetentionDays: 90,
    },
    features: ENTERPRISE_FEATURES,
    highlights: [
      'Custom bot limits & team sizes',
      'Organization management',
      'Advanced permissions & audit logs',
      'Custom integrations & deployment',
      'Dedicated support options',
      'Negotiated resource allowances',
    ],
    rank: 3,
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
