import { DEVELOPER_PORTAL_URL, type LogLevel } from '@delyforge/shared';
import { Activity, Clock, Cpu, ExternalLink, MemoryStick, Plug, Server, SquareSlash, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { InviteLink } from '@/components/bots/permissions-editor';
import { Sparkline } from '@/components/bots/runtime-ui';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, IconTile } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { call } from '@/lib/bridge';
import { formatDuration, formatMb, useBotLogs, useNow, useRuntimeState } from '@/lib/runtime';
import { useBotContext } from './layout';

function Metric({
  icon,
  label,
  value,
  hint,
  chart,
}: {
  icon: typeof Clock;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  chart?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
        <IconTile icon={icon} size="sm" tone="neutral" />
        {label}
      </div>
      <div className="mt-2.5 text-xl font-semibold tracking-[-0.02em] text-fg tabular-nums">{value}</div>
      {hint ? <div className="text-2xs text-fg-subtle">{hint}</div> : null}
      {chart ? <div className="mt-2">{chart}</div> : null}
    </Card>
  );
}

export const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: 'text-fg-subtle',
  info: 'text-fg-muted',
  warn: 'text-warning',
  error: 'text-danger',
};

export function BotOverview() {
  const { bot } = useBotContext();
  const state = useRuntimeState(bot.id);
  const logs = useBotLogs(bot.id);
  const running = state.status === 'online' || state.status === 'reconnecting';
  const now = useNow(running);
  const m = state.metrics;
  const history = state.history;

  if (!bot.hasToken) {
    return (
      <Card className="relative overflow-hidden" data-route-ready={`/bots/${bot.id}`}>
        <div className="pointer-events-none absolute inset-0" style={{ background: 'var(--df-glow)' }} />
        <EmptyState
          className="relative py-14"
          icon={Plug}
          title="Connect this bot to Discord"
          description="A short guided setup: create a Discord application, paste its token, invite the bot to your server and go live."
        >
          <Button variant="primary" asChild>
            <Link to="connect">Start setup</Link>
          </Button>
        </EmptyState>
      </Card>
    );
  }

  const error = state.lastError;
  return (
    <div className="space-y-3" data-route-ready={`/bots/${bot.id}`}>
      {error && (state.status === 'error' || state.status === 'crashed') ? (
        <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="flex-1 text-sm">
            <p className="text-fg">{error.message}</p>
            {error.code === 'INVALID_TOKEN' ? (
              <Link to="connect" className="mt-1 inline-block text-xs font-medium text-primary hover:underline">
                Reconnect with a new token →
              </Link>
            ) : error.code === 'DISALLOWED_INTENTS' ? (
              <button
                type="button"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                onClick={() => void call((b) => b.shell.openExternal(DEVELOPER_PORTAL_URL))}
              >
                Open the Developer Portal <ExternalLink className="size-3" />
              </button>
            ) : (
              <Link to="console" className="mt-1 inline-block text-xs font-medium text-primary hover:underline">
                See the console for details →
              </Link>
            )}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Metric
          icon={Clock}
          label="Uptime"
          value={running && state.readyAt ? formatDuration(now - new Date(state.readyAt).getTime()) : '—'}
          hint={state.restartCount > 0 ? `${state.restartCount} automatic restart${state.restartCount === 1 ? '' : 's'} this session` : running ? 'Since last start' : 'Not running'}
        />
        <Metric
          icon={Server}
          label="Servers"
          value={running ? (m?.guildCount ?? bot.guildCount) : bot.guildCount}
          hint={running ? 'Live' : 'Last known'}
        />
        <Metric
          icon={SquareSlash}
          label="Commands"
          value={bot.commandsExecuted}
          hint={`All time · ${state.commandsThisSession} this session`}
        />
        <Metric
          icon={Activity}
          label="Discord latency"
          value={m?.pingMs != null ? `${m.pingMs} ms` : '—'}
          chart={<Sparkline values={history.map((h) => h.pingMs)} />}
        />
        <Metric
          icon={MemoryStick}
          label="Memory"
          value={m ? formatMb(m.rssBytes) : '—'}
          chart={<Sparkline values={history.map((h) => h.rssMb)} />}
        />
        <Metric
          icon={Cpu}
          label="CPU"
          value={m ? `${m.cpuPercent.toFixed(1)}%` : '—'}
          chart={<Sparkline values={history.map((h) => h.cpuPercent)} max={10} />}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="col-span-2">
          <CardHeader
            title="Recent console output"
            action={
              <Button size="sm" variant="ghost" asChild>
                <Link to="console">Open console</Link>
              </Button>
            }
          />
          <CardBody>
            <div className="h-48 overflow-hidden rounded-lg border border-border bg-bg-subtle p-3 font-mono text-2xs leading-5" data-selectable>
              {(logs.data ?? []).slice(-9).map((l) => (
                <div key={l.id} className="truncate">
                  <span className="text-fg-subtle">{new Date(l.createdAt).toLocaleTimeString()} </span>
                  <span className={LEVEL_STYLES[l.level]}>{l.message}</span>
                </div>
              ))}
              {logs.data?.length === 0 ? <div className="text-fg-subtle">No output yet. Start the bot to see what it’s doing.</div> : null}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Invite link" description="Add the bot to another server." />
          <CardBody>
            {bot.discordApplicationId ? <InviteLink applicationId={bot.discordApplicationId} permissions={bot.permissions} /> : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export function levelClass(level: LogLevel): string {
  return cn(LEVEL_STYLES[level]);
}
