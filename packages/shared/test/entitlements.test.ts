import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANS,
  hasFeature,
  isWithinLimit,
  lowestPlanWithFeature,
  resolveEntitlements,
} from '../src/index.js';

const now = new Date('2026-11-14T12:00:00Z');
const day = 24 * 60 * 60 * 1000;

describe('resolveEntitlements', () => {
  it('gives free users the free plan', () => {
    const e = resolveEntitlements({ planId: 'free', status: 'none', now });
    expect(e.effectivePlanId).toBe('free');
    expect(e.reason).toBe('free_plan');
    expect(e.limits.maxBotProjects).toBe(1);
  });

  it('grants the subscribed plan when active or trialing', () => {
    expect(resolveEntitlements({ planId: 'pro', status: 'active', now }).effectivePlanId).toBe('pro');
    const trial = resolveEntitlements({ planId: 'business', status: 'trialing', now });
    expect(trial.effectivePlanId).toBe('business');
    expect(trial.reason).toBe('trialing');
  });

  it('keeps access during the past_due grace period', () => {
    const e = resolveEntitlements({
      planId: 'pro',
      status: 'past_due',
      currentPeriodEnd: new Date(now.getTime() - 2 * day),
      graceDays: 7,
      now,
    });
    expect(e.effectivePlanId).toBe('pro');
    expect(e.reason).toBe('grace_period');
    expect(e.graceEndsAt?.toISOString()).toBe(new Date(now.getTime() + 5 * day).toISOString());
  });

  it('falls back to free after the grace period ends', () => {
    const e = resolveEntitlements({
      planId: 'pro',
      status: 'past_due',
      currentPeriodEnd: new Date(now.getTime() - 8 * day),
      graceDays: 7,
      now,
    });
    expect(e.effectivePlanId).toBe('free');
    expect(e.reason).toBe('subscription_inactive');
    expect(e.subscribedPlanId).toBe('pro');
  });

  it('falls back to free for canceled / unpaid subscriptions', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'] as const) {
      expect(resolveEntitlements({ planId: 'business', status, now }).effectivePlanId).toBe('free');
    }
  });

  it('applies admin overrides last', () => {
    const e = resolveEntitlements({
      planId: 'free',
      status: 'none',
      now,
      overrides: { grantFeatures: ['ai.builder'], limits: { maxBotProjects: 3 } },
    });
    expect(hasFeature(e, 'ai.builder')).toBe(true);
    expect(e.limits.maxBotProjects).toBe(3);
  });
});

describe('limits and features', () => {
  it('checks count limits, treating null as unlimited', () => {
    const free = resolveEntitlements({ planId: 'free', status: 'none', now });
    expect(isWithinLimit(free, 'maxBotProjects', 1)).toBe(true);
    expect(isWithinLimit(free, 'maxBotProjects', 2)).toBe(false);
    const ent = resolveEntitlements({ planId: 'enterprise', status: 'active', now });
    expect(isWithinLimit(ent, 'maxBotProjects', 10_000)).toBe(true);
  });

  it('finds the cheapest plan with a feature', () => {
    expect(lowestPlanWithFeature('ai.builder')?.id).toBe('pro');
    expect(lowestPlanWithFeature('team.workspaces')?.id).toBe('business');
    expect(lowestPlanWithFeature('audit.logs')?.id).toBe('enterprise');
  });

  it('matches the published pricing', () => {
    expect(DEFAULT_PLANS.pro.pricing?.monthlyUsdCents).toBe(999);
    expect(DEFAULT_PLANS.business.pricing?.monthlyUsdCents).toBe(2499);
    expect(DEFAULT_PLANS.enterprise.pricing).toBeNull();
  });

  it('higher plans include every feature of the plan below (except support tier)', () => {
    const order = ['free', 'pro', 'business', 'enterprise'] as const;
    for (let i = 1; i < order.length; i++) {
      const lower = DEFAULT_PLANS[order[i - 1]!];
      const higher = DEFAULT_PLANS[order[i]!];
      for (const f of lower.features) {
        if (f.startsWith('support.') || f === 'templates.limited') continue;
        expect(higher.features, `${higher.id} should include ${f}`).toContain(f);
      }
    }
  });
});
