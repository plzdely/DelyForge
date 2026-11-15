import { type GuildInfo, MODULES, hasFeature, isImplementedModule, lowestPlanWithFeature, resolveGuildModules } from '@delyforge/shared';
import { ChevronRight, Lock, Plug, Server } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { InviteLink } from '@/components/bots/permissions-editor';
import { GuildPicker } from '@/components/modules/pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { useEntitlements } from '@/lib/entitlements';
import { useBotModules, useGuilds, useRefreshGuilds } from '@/lib/modules';
import { useBotContext } from './layout';

/**
 * Shared by the Modules tab and each module's settings page: the bot's servers and which one is selected
 * (kept in the URL as `?server=` so it survives navigation).
 */
export function useModuleWorkspace() {
  const { bot } = useBotContext();
  const guilds = useGuilds(bot.id, bot.hasToken);
  const modules = useBotModules(bot.id);
  const refresh = useRefreshGuilds(bot.id);
  const [params, setParams] = useSearchParams();
  const list = guilds.data ?? [];
  const guild: GuildInfo | undefined = list.find((g) => g.id === params.get('server')) ?? list[0];
  const selectGuild = (id: string) => setParams({ server: id }, { replace: true });
  return { bot, guilds, modules, refresh, guild, selectGuild };
}

/** Shown instead of module settings until the bot is connected and in at least one server. */
export function ModuleWorkspaceGate({ ws, route, children }: { ws: ReturnType<typeof useModuleWorkspace>; route: string; children: React.ReactNode }) {
  const { bot, guilds, guild } = ws;
  if (!bot.hasToken) {
    return (
      <Card data-route-ready={route}>
        <EmptyState icon={Plug} title="Connect this bot first" description="Modules are set up per Discord server, so the bot needs to be connected and invited.">
          <Button variant="primary" asChild>
            <Link to={`/bots/${bot.id}/connect`}>Connect to Discord</Link>
          </Button>
        </EmptyState>
      </Card>
    );
  }
  if (guilds.isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (guilds.isError) {
    return (
      <Card className="p-5 text-sm text-danger" data-route-ready={route}>
        Couldn’t load your servers from Discord: {(guilds.error as Error).message}
      </Card>
    );
  }
  if (!guild) {
    return (
      <Card className="p-6" data-route-ready={route}>
        <EmptyState icon={Server} title="Invite your bot to a server" description="Your bot isn’t in any server yet. Invite it, then come back and press reload." />
        {bot.discordApplicationId ? (
          <div className="mx-auto max-w-xl">
            <InviteLink applicationId={bot.discordApplicationId} permissions={bot.permissions} />
          </div>
        ) : null}
      </Card>
    );
  }
  return <>{children}</>;
}

export function BotModules() {
  const ws = useModuleWorkspace();
  const entitlements = useEntitlements();
  const route = `/bots/${ws.bot.id}/modules`;
  const config = ws.guild ? resolveGuildModules(ws.modules.data?.[ws.guild.id]) : null;

  return (
    <ModuleWorkspaceGate ws={ws} route={route}>
      <div data-route-ready={ws.modules.data ? route : undefined}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="text-sm text-fg-muted">Settings apply to the selected server only.</p>
          {ws.guild ? (
            <GuildPicker
              guilds={ws.guilds.data ?? []}
              value={ws.guild.id}
              onChange={ws.selectGuild}
              onRefresh={() => ws.refresh.mutate()}
              refreshing={ws.refresh.isPending}
            />
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {MODULES.map((m) => {
            const locked = !hasFeature(entitlements, m.feature);
            const enabled = config && isImplementedModule(m.id) ? config[m.id].enabled : false;
            const plan = lowestPlanWithFeature(m.feature);
            const body = (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-fg">{m.name}</span>
                    {!m.available ? (
                      <Badge>Coming soon</Badge>
                    ) : locked ? (
                      <Badge>
                        <Lock /> {plan?.name}
                      </Badge>
                    ) : enabled ? (
                      <Badge tone="success">On</Badge>
                    ) : (
                      <Badge>Off</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-fg-subtle">{m.summary}</p>
                </div>
                {m.available ? <ChevronRight className="size-4 shrink-0 text-fg-subtle" /> : null}
              </>
            );
            const cls = cn(
              'flex items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors',
              m.available ? 'hover:border-border-strong' : 'opacity-60',
            );
            return m.available ? (
              <Link key={m.id} to={`${m.id}?server=${ws.guild?.id ?? ''}`} className={cls}>
                {body}
              </Link>
            ) : (
              <div key={m.id} className={cls}>
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </ModuleWorkspaceGate>
  );
}
