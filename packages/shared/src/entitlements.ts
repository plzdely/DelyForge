import { DEFAULT_PLANS, type FeatureKey, type PlanDefinition, type PlanId, type PlanLimits } from './plans.js';

/** Mirrors Stripe subscription statuses, plus `none` for users who never subscribed. */
export type SubscriptionStatus =
  | 'none'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export interface EntitlementOverrides {
  /** Extra features granted by an admin (e.g. Enterprise deal, beta access). */
  grantFeatures?: readonly FeatureKey[];
  /** Per-limit overrides. `null` = unlimited. */
  limits?: Partial<PlanLimits>;
}

export interface EntitlementInput {
  planId: PlanId;
  status: SubscriptionStatus;
  /** End of the current paid period. Required for the past_due grace calculation. */
  currentPeriodEnd?: Date | null;
  /** Days of full access kept after a failed payment before falling back to Free. */
  graceDays?: number;
  overrides?: EntitlementOverrides | null;
  now?: Date;
  /** Plan catalogue to resolve against (defaults to the built-in catalogue; the API passes DB plans). */
  catalogue?: Readonly<Record<PlanId, PlanDefinition>>;
}

export type EntitlementReason = 'active' | 'trialing' | 'grace_period' | 'free_plan' | 'subscription_inactive';

export interface Entitlements {
  /** The plan the customer is subscribed to. */
  subscribedPlanId: PlanId;
  /** The plan whose limits actually apply right now. */
  effectivePlanId: PlanId;
  reason: EntitlementReason;
  limits: PlanLimits;
  features: FeatureKey[];
  /** When grace access ends (only set during a grace period). */
  graceEndsAt: Date | null;
}

export const DEFAULT_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide what a customer can use right now. This is the single implementation of entitlement rules, used by the API
 * (authoritative) and by the desktop app (to display limits / enforce local limits from a signed token).
 *
 * Rules:
 *  - active / trialing  → subscribed plan.
 *  - past_due           → subscribed plan until `currentPeriodEnd + graceDays`, then Free.
 *  - anything else      → Free. Projects are NEVER deleted; they just exceed limits (see downgrade handling).
 *  - Admin overrides are applied last.
 */
export function resolveEntitlements(input: EntitlementInput): Entitlements {
  const catalogue = input.catalogue ?? DEFAULT_PLANS;
  const now = input.now ?? new Date();
  const graceDays = input.graceDays ?? DEFAULT_GRACE_DAYS;

  let effectivePlanId: PlanId = 'free';
  let reason: EntitlementReason = input.planId === 'free' ? 'free_plan' : 'subscription_inactive';
  let graceEndsAt: Date | null = null;

  if (input.planId !== 'free') {
    if (input.status === 'active') {
      effectivePlanId = input.planId;
      reason = 'active';
    } else if (input.status === 'trialing') {
      effectivePlanId = input.planId;
      reason = 'trialing';
    } else if (input.status === 'past_due' && input.currentPeriodEnd) {
      const ends = new Date(input.currentPeriodEnd.getTime() + graceDays * DAY_MS);
      if (now.getTime() < ends.getTime()) {
        effectivePlanId = input.planId;
        reason = 'grace_period';
        graceEndsAt = ends;
      }
    }
  }

  const plan = catalogue[effectivePlanId];
  const features = new Set<FeatureKey>(plan.features);
  for (const f of input.overrides?.grantFeatures ?? []) features.add(f);

  return {
    subscribedPlanId: input.planId,
    effectivePlanId,
    reason,
    limits: { ...plan.limits, ...(input.overrides?.limits ?? {}) },
    features: [...features],
    graceEndsAt,
  };
}

export function hasFeature(entitlements: Pick<Entitlements, 'features'>, feature: FeatureKey): boolean {
  return entitlements.features.includes(feature);
}

type CountLimit = 'maxBotProjects' | 'maxWorkflows' | 'maxTeamMembers';

/** True if the customer may have `nextCount` of a resource (e.g. creating their Nth bot). */
export function isWithinLimit(
  entitlements: Pick<Entitlements, 'limits'>,
  limit: CountLimit,
  nextCount: number,
): boolean {
  const max = entitlements.limits[limit];
  return max === null || nextCount <= max;
}

/** Find the cheapest plan that includes a feature — used for "Upgrade to Pro to unlock" messages. */
export function lowestPlanWithFeature(
  feature: FeatureKey,
  catalogue: Readonly<Record<PlanId, PlanDefinition>> = DEFAULT_PLANS,
): PlanDefinition | null {
  return (
    Object.values(catalogue)
      .filter((p) => p.features.includes(feature))
      .sort((a, b) => a.rank - b.rank)[0] ?? null
  );
}
