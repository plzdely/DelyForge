import { type Entitlements, resolveEntitlements } from '@delyforge/shared';
import { useMemo } from 'react';

/**
 * Entitlements as seen by the desktop UI.
 *
 * Until accounts ship (Phase 7) the app runs locally on the Free plan. After that this hook will read the
 * server-signed entitlement token instead (ARCHITECTURE.md §8) — the UI using it does not need to change.
 */
export function useEntitlements(): Entitlements {
  return useMemo(() => resolveEntitlements({ planId: 'free', status: 'none' }), []);
}
