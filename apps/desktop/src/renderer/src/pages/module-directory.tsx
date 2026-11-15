import { hasFeature, isImplementedModule, lowestPlanWithFeature, moduleInfo, resolveGuildModules } from '@delyforge/shared';
import { Bot, ChevronRight, Lock } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { BotIdentityAvatar } from '@/components/bots/bot-avatar';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { useEntitlements } from '@/lib/entitlements';
import { useBotModules } from '@/lib/modules';
import { useBots } from '@/lib/queries';

/** How many servers have this module switched on for one bot. */
function EnabledCount({ botId, moduleId }: { botId: string; moduleId: string }) {
  const modules = useBotModules(botId);
  if (!isImplementedModule(moduleId) || !modules.data) return null;
  const n = Object.values(modules.data).filter((g) => resolveGuildModules(g)[moduleId].enabled).length;
  return n ? <Badge tone="success">On in {n} server{n === 1 ? '' : 's'}</Badge> : <Badge>Off</Badge>;
}

/** Sidebar entry for a module: pick which bot to configure it for. */
export function ModuleDirectoryPage() {
  const { moduleId = '' } = useParams();
  const bots = useBots();
  const entitlements = useEntitlements();
  if (!isImplementedModule(moduleId)) return null;
  const info = moduleInfo(moduleId);
  const locked = !hasFeature(entitlements, info.feature);
  const list = bots.data ?? [];

  return (
    <Page route={`/modules/${moduleId}`} ready={!bots.isLoading} width="narrow">
      <PageHeader
        eyebrow="Module"
        title={info.name}
        description={info.summary}
        actions={locked ? <Badge><Lock /> {lowestPlanWithFeature(info.feature)?.name} plan</Badge> : null}
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={Bot} title="No bots yet" description="Create a bot and connect it to Discord to use this module.">
            <Button variant="primary" asChild>
              <Link to="/bots/new">Create bot</Link>
            </Button>
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-border px-5 py-3 text-xs text-fg-subtle">Choose a bot to set up {info.name} for.</div>
          <ul>
            {list.map((bot) => (
              <li key={bot.id} className="border-b border-border last:border-0">
                <Link to={bot.hasToken ? `/bots/${bot.id}/modules/${moduleId}` : `/bots/${bot.id}/connect`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-hover/50">
                  <BotIdentityAvatar bot={bot} size="sm" />
                  <span className="flex-1 truncate text-sm font-medium text-fg">{bot.name}</span>
                  {bot.hasToken ? <EnabledCount botId={bot.id} moduleId={moduleId} /> : <Badge>Not connected</Badge>}
                  <ChevronRight className="size-4 text-fg-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}
