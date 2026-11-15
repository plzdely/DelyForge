import { type AccountEntitlements, FEATURE_KEYS, isPlanId, resolveEntitlements } from '@delyforge/shared';

/**
 * Decides what this installation may use. The renderer asks the main process — it never decides for itself.
 *
 * Today: no accounts exist yet, so everyone is on the Free plan.
 * Development only: `DELYFORGE_DEV_PLAN=pro` (or business / enterprise) simulates a paid plan so features and limits
 * can be tested. This is ignored in packaged (customer) builds.
 * Phase 7 replaces this with the server-signed entitlement token (ARCHITECTURE.md §8).
 */
export function createEntitlementsProvider(opts: { isPackaged: boolean; devPlan: string | undefined; personal?: boolean }) {
  if (opts.personal) {
    // Personal edition: the top plan's features and limits (unlimited bots and workflows), decided on this computer.
    // Every feature key (the top plan alone lacks Free-only keys such as the starter templates).
    const value: AccountEntitlements = { ...resolveEntitlements({ planId: 'enterprise', status: 'active' }), features: [...FEATURE_KEYS], graceEndsAt: null, source: 'personal' };
    return () => value;
  }
  const override = !opts.isPackaged && isPlanId(opts.devPlan) && opts.devPlan !== 'free' ? opts.devPlan : null;
  const resolved = resolveEntitlements(override ? { planId: override, status: 'active' } : { planId: 'free', status: 'none' });
  const value: AccountEntitlements = {
    ...resolved,
    graceEndsAt: null,
    source: override ? 'dev-override' : 'local',
  };
  return () => value;
}
