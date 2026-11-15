import type { AiUsageInfo } from '@delyforge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from './bridge';
import { builderKeys } from './builders';
import { moduleKeys } from './modules';

export const aiKeys = { usage: ['ai-usage'] as const };

export function useAiUsage(enabled: boolean) {
  return useQuery({ queryKey: aiKeys.usage, queryFn: () => call((b) => b.ai.usage()), enabled, staleTime: 60_000, retry: false });
}

export function useAiBuild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; guildId: string; prompt: string }) => call((b) => b.ai.build(input)),
    onSuccess: (r) => qc.setQueryData<AiUsageInfo>(aiKeys.usage, r.usage),
  });
}

export function useAiDecision(botId: string) {
  const qc = useQueryClient();
  const apply = useMutation({
    mutationFn: (proposalId: string) => call((b) => b.ai.apply(proposalId)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: moduleKeys.modules(botId) });
      void qc.invalidateQueries({ queryKey: builderKeys.builders(botId) });
    },
  });
  const reject = useMutation({ mutationFn: (proposalId: string) => call((b) => b.ai.reject(proposalId)) });
  return { apply, reject };
}

export function useAiTroubleshoot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; question: string }) => call((b) => b.ai.troubleshoot(input)),
    onSuccess: (r) => qc.setQueryData<AiUsageInfo>(aiKeys.usage, r.usage),
  });
}
