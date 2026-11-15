import type { BotModules, ImplementedModuleId } from '@delyforge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from './bridge';

export const moduleKeys = {
  modules: (id: string) => ['modules', id] as const,
  guilds: (id: string) => ['guilds', id] as const,
};

export function useBotModules(botId: string) {
  return useQuery({ queryKey: moduleKeys.modules(botId), queryFn: () => call((b) => b.modules.get(botId)) });
}

/** Servers the bot is in, with channels and roles. Cached by the main process for a minute. */
export function useGuilds(botId: string, enabled: boolean) {
  return useQuery({
    queryKey: moduleKeys.guilds(botId),
    queryFn: () => call((b) => b.discord.guilds(botId)),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useRefreshGuilds(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call((b) => b.discord.guilds(botId, true)),
    onSuccess: (data) => {
      qc.setQueryData(moduleKeys.guilds(botId), data);
      void qc.invalidateQueries({ queryKey: ['bots'] }); // privileged intent flags may have changed
    },
  });
}

export function useUpdateModule(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { guildId: string; moduleId: ImplementedModuleId; config: unknown }) =>
      call((b) => b.modules.update({ id: botId, ...input })),
    onSuccess: (res) => qc.setQueryData<BotModules>(moduleKeys.modules(botId), res.modules),
  });
}
