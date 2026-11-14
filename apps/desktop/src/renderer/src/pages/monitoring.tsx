import { Activity, Play, Square } from 'lucide-react';
import { Link } from 'react-router';
import { BotControls, BotStatusLine, Sparkline } from '@/components/bots/runtime-ui';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { useBots } from '@/lib/queries';
import { formatDuration, formatMb, useNow, useRuntimeControls, useRuntimeStates } from '@/lib/runtime';
import { BotIdentityAvatar } from '@/components/bots/bot-avatar';

export function MonitoringPage() {
  const bots = useBots();
  const states = useRuntimeStates();
  const { startAll, stopAll } = useRuntimeControls();
  const anyRunning = (states.data ?? []).some((s) => s.status === 'online' || s.status === 'reconnecting' || s.status === 'starting');
  const now = useNow(anyRunning);
  const list = bots.data ?? [];
  const online = (states.data ?? []).filter((s) => s.status === 'online').length;

  return (
    <Page route="/monitoring" ready={!bots.isLoading && !states.isLoading}>
      <PageHeader
        title="Bot Monitoring"
        description={`${online} of ${list.length} bot${list.length === 1 ? '' : 's'} online · updates live`}
        actions={
          <>
            <Button onClick={() => stopAll.mutate()} disabled={stopAll.isPending || !anyRunning}>
              <Square className="fill-current" /> Stop all
            </Button>
            <Button variant="primary" onClick={() => startAll.mutate()} disabled={startAll.isPending}>
              <Play className="fill-current" /> Start all
            </Button>
          </>
        }
      />

      {bots.isLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={Activity} title="Nothing to monitor yet" description="Create a bot and connect it to Discord to see its health here.">
            <Button variant="primary" asChild>
              <Link to="/bots/new">Create bot</Link>
            </Button>
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-2xs font-medium tracking-[0.06em] text-fg-subtle uppercase">
                <th className="px-4 py-2.5 font-medium">Bot</th>
                <th className="px-4 py-2.5 font-medium">Uptime</th>
                <th className="px-4 py-2.5 font-medium">Latency</th>
                <th className="w-36 px-4 py-2.5 font-medium">Memory</th>
                <th className="px-4 py-2.5 font-medium">CPU</th>
                <th className="px-4 py-2.5 font-medium">Servers</th>
                <th className="px-4 py-2.5 text-right font-medium">Control</th>
              </tr>
            </thead>
            <tbody>
              {list.map((bot) => {
                const s = states.data?.find((x) => x.botId === bot.id);
                const m = s?.metrics;
                const live = s?.status === 'online' || s?.status === 'reconnecting';
                return (
                  <tr key={bot.id} className="border-b border-border last:border-0 hover:bg-surface-hover/40">
                    <td className="px-4 py-3">
                      <Link to={`/bots/${bot.id}`} className="flex items-center gap-3">
                        <BotIdentityAvatar bot={bot} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-fg">{bot.name}</div>
                          <BotStatusLine bot={bot} />
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-fg-muted tabular-nums">
                      {live && s?.readyAt ? formatDuration(now - new Date(s.readyAt).getTime()) : '—'}
                    </td>
                    <td className="px-4 py-3 text-fg-muted tabular-nums">{m?.pingMs != null ? `${m.pingMs} ms` : '—'}</td>
                    <td className="px-4 py-3">
                      {m ? (
                        <div className="flex items-center gap-2">
                          <span className="w-14 text-fg-muted tabular-nums">{formatMb(m.rssBytes)}</span>
                          <Sparkline className="h-6 w-16" values={(s?.history ?? []).map((h) => h.rssMb)} />
                        </div>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg-muted tabular-nums">{m ? `${m.cpuPercent.toFixed(1)}%` : '—'}</td>
                    <td className="px-4 py-3 text-fg-muted tabular-nums">{m?.guildCount ?? bot.guildCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <BotControls bot={bot} size="sm" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
