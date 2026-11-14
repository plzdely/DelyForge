import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppSettings,
  AppSettingsPatch,
  CreateBotProjectInput,
  UpdateBotProjectInput,
} from '@delyforge/shared';
import { toast } from 'sonner';
import { call } from './bridge';

export const queryKeys = {
  appInfo: ['app-info'] as const,
  settings: ['settings'] as const,
  dashboard: ['dashboard-summary'] as const,
  bots: ['bots'] as const,
  bot: (id: string) => ['bots', id] as const,
};

// ─── Bot projects ─────────────────────────────────────────────────────────────────────────────────────────────────

export function useBots() {
  return useQuery({ queryKey: queryKeys.bots, queryFn: () => call((b) => b.bots.list()) });
}

export function useBot(id: string) {
  return useQuery({
    queryKey: queryKeys.bot(id),
    queryFn: () => call((b) => b.bots.get(id)),
    retry: (count, err) => (err as { code?: string }).code !== 'NOT_FOUND' && count < 1,
  });
}

/** After any change to bot projects, refresh every view that shows them. */
function useInvalidateBots() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.bots });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
  };
}

export function useCreateBot() {
  const invalidate = useInvalidateBots();
  return useMutation({
    mutationFn: (input: CreateBotProjectInput) => call((b) => b.bots.create(input)),
    onSuccess: invalidate,
  });
}

export function useUpdateBot() {
  const invalidate = useInvalidateBots();
  return useMutation({
    mutationFn: (input: UpdateBotProjectInput) => call((b) => b.bots.update(input)),
    onSuccess: invalidate,
  });
}

export function useDuplicateBot() {
  const invalidate = useInvalidateBots();
  return useMutation({ mutationFn: (id: string) => call((b) => b.bots.duplicate(id)), onSuccess: invalidate });
}

export function useDeleteBot() {
  const qc = useQueryClient();
  const invalidate = useInvalidateBots();
  return useMutation({
    mutationFn: (id: string) => call((b) => b.bots.remove(id)),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: queryKeys.bot(id) });
      invalidate();
    },
  });
}

export function useExportBot() {
  const invalidate = useInvalidateBots();
  return useMutation({ mutationFn: (id: string) => call((b) => b.bots.exportToFile(id)), onSuccess: invalidate });
}

export function useImportBot() {
  const invalidate = useInvalidateBots();
  return useMutation({ mutationFn: () => call((b) => b.bots.importFromFile()), onSuccess: invalidate });
}

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
