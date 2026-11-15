import type { AccountStatus } from '@delyforge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { call } from './bridge';
import { queryKeys } from './queries';

export const accountKeys = { status: ['account'] as const, invoices: ['invoices'] as const };

export function useAccount() {
  return useQuery({ queryKey: accountKeys.status, queryFn: () => call((b) => b.account.status()), staleTime: 30_000 });
}

/** Everything that depends on the signed-in plan refreshes together. */
export function useInvalidateAccount() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: accountKeys.status });
    void qc.invalidateQueries({ queryKey: ['entitlements'] });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    void qc.invalidateQueries({ queryKey: accountKeys.invoices });
  };
}

export function useAccountAction<T>(fn: (input: T) => Promise<AccountStatus | null>, success?: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: fn,
    onSuccess: (status) => {
      if (status) qc.setQueryData(accountKeys.status, status);
      invalidate();
      if (success) toast.success(success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useInvoices(enabled: boolean) {
  return useQuery({ queryKey: accountKeys.invoices, queryFn: () => call((b) => b.billing.invoices()), enabled, retry: false });
}
