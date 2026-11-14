import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettings, AppSettingsPatch } from '@delyforge/shared';
import { toast } from 'sonner';
import { call } from './bridge';

export const queryKeys = {
  appInfo: ['app-info'] as const,
  settings: ['settings'] as const,
  dashboard: ['dashboard-summary'] as const,
};

export function useAppInfo() {
  return useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: () => call((b) => b.app.getInfo()),
    staleTime: Infinity,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => call((b) => b.settings.get()),
    staleTime: Infinity,
  });
}

/** Optimistic settings update: the UI changes instantly and rolls back if saving fails. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AppSettingsPatch) => call((b) => b.settings.update(patch)),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: queryKeys.settings });
      const previous = qc.getQueryData<AppSettings>(queryKeys.settings);
      if (previous) qc.setQueryData<AppSettings>(queryKeys.settings, { ...previous, ...patch });
      return { previous };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.settings, ctx.previous);
      toast.error('Could not save setting', { description: (err as Error).message });
    },
    onSuccess: (next) => qc.setQueryData(queryKeys.settings, next),
  });
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => call((b) => b.dashboard.getSummary()),
    refetchInterval: 15_000,
  });
}
