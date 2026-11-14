import { type AccountEntitlements, resolveEntitlements } from '@delyforge/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from './bridge';

const FREE_FALLBACK: AccountEntitlements = {
  ...resolveEntitlements({ planId: 'free', status: 'none' }),
  graceEndsAt: null,
  source: 'local',
};

/**
 * What this installation may use, as decided by the main process (never by the UI itself).
 * While loading, the Free plan is assumed — the most restrictive option, so nothing is shown that isn't allowed.
 */
export function useEntitlements(): AccountEntitlements {
  const { data } = useQuery({
    queryKey: ['entitlements'],
    queryFn: () => call((b) => b.account.getEntitlements()),
    staleTime: Infinity,
  });
  return data ?? FREE_FALLBACK;
}
