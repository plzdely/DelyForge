import type { Builders } from '@delyforge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from './bridge';
import { moduleKeys } from './modules';

export const builderKeys = {
  builders: (id: string) => ['builders', id] as const,
  runs: (id: string) => ['workflow-runs', id] as const,
};

export function useBuilders(botId: string) {
  return useQuery({ queryKey: builderKeys.builders(botId), queryFn: () => call((b) => b.builders.get(botId)) });
}

export function useSaveBuilders(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (builders: Builders) => call((b) => b.builders.save(botId, builders)),
    onSuccess: (saved) => qc.setQueryData(builderKeys.builders(botId), saved),
  });
}

export function useWorkflowRuns(botId: string) {
  return useQuery({ queryKey: builderKeys.runs(botId), queryFn: () => call((b) => b.builders.workflowRuns(botId)), refetchInterval: 10_000 });
}

export function useApplyTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; guildId: string; templateId: string }) => call((b) => b.templates.apply(input)),
    onSuccess: (res, input) => {
      qc.setQueryData(builderKeys.builders(input.id), res.builders);
      qc.setQueryData(moduleKeys.modules(input.id), res.modules);
    },
  });
}
