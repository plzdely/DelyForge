import type { BotProject, BotRuntimeState, BotRuntimeStatus } from '@delyforge/shared';
import { Play, RotateCcw, Square } from 'lucide-react';
import { Link } from 'react-router';
import { StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useRuntimeControls, useRuntimeState } from '@/lib/runtime';

const LABELS: Record<BotRuntimeStatus, string> = {
  offline: 'Offline',
  starting: 'Starting…',
  online: 'Online',
  reconnecting: 'Reconnecting…',
  stopping: 'Stopping…',
  crashed: 'Crashed',
  error: 'Error',
};

const DOT: Record<BotRuntimeStatus, 'online' | 'offline' | 'starting' | 'error'> = {
  offline: 'offline',
  starting: 'starting',
  online: 'online',
  reconnecting: 'starting',
  stopping: 'starting',
  crashed: 'error',
  error: 'error',
};

export function statusLabel(state: BotRuntimeState): string {
  if (state.status === 'crashed' && state.restartInSeconds !== null) return `Crashed — restarting in ${state.restartInSeconds}s`;
  return LABELS[state.status];
}

/** Status of a bot, combining whether it is connected to Discord with its live runtime state. */
export function BotStatusLine({ bot, className }: { bot: BotProject; className?: string }) {
  const state = useRuntimeState(bot.id);
  if (!bot.hasToken) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-fg-subtle', className)}>
        <StatusDot status="offline" />
        Not connected to Discord
      </span>
    );
  }
  const tone =
    state.status === 'online'
      ? 'text-success'
      : state.status === 'crashed' || state.status === 'error'
        ? 'text-danger'
        : state.status === 'offline'
          ? 'text-fg-subtle'
          : 'text-warning';
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', tone, className)}>
      <StatusDot status={DOT[state.status]} />
      {statusLabel(state)}
    </span>
  );
}

/** Start / Stop / Restart buttons for one bot. Only working actions are shown for the current state. */
export function BotControls({ bot, size = 'md' }: { bot: BotProject; size?: 'sm' | 'md' }) {
  const state = useRuntimeState(bot.id);
  const { start, stop, restart } = useRuntimeControls();

  if (!bot.hasToken) {
    return (
      <Button variant="primary" size={size} asChild>
        <Link to={`/bots/${bot.id}/connect`}>Connect to Discord</Link>
      </Button>
    );
  }

  const running = state.status === 'online' || state.status === 'starting' || state.status === 'reconnecting';
  const busy = state.status === 'stopping' || start.isPending || stop.isPending || restart.isPending;
  const scheduled = state.status === 'crashed' && state.restartInSeconds !== null;

  if (running || scheduled) {
    return (
      <div className="flex items-center gap-1.5">
        {running ? (
          <Tooltip content="Disconnect and start again">
            <Button size={size} disabled={busy} onClick={() => restart.mutate(bot.id)} aria-label="Restart">
              <RotateCcw /> {size === 'md' ? 'Restart' : null}
            </Button>
          </Tooltip>
        ) : null}
        <Button size={size} disabled={busy} onClick={() => stop.mutate(bot.id)}>
          <Square className="fill-current" /> {scheduled ? 'Cancel restart' : 'Stop'}
        </Button>
      </div>
    );
  }
  return (
    <Button variant="primary" size={size} disabled={busy} onClick={() => start.mutate(bot.id)}>
      <Play className="fill-current" /> {state.status === 'stopping' ? 'Stopping…' : 'Start'}
    </Button>
  );
}

/** Minimal SVG line chart for live metrics. */
export function Sparkline({
  values,
  className,
  max,
}: {
  values: (number | null)[];
  className?: string;
  max?: number;
}) {
  const nums = values.map((v) => v ?? 0);
  if (nums.length < 2) {
    return <div className={cn('h-10 rounded-md border border-dashed border-border', className)} />;
  }
  const top = Math.max(max ?? 0, ...nums, 1);
  const w = 120;
  const h = 40;
  const points = nums.map((v, i) => `${(i / (nums.length - 1)) * w},${h - (v / top) * (h - 4) - 2}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn('h-10 w-full', className)} aria-hidden="true">
      <polyline points={`0,${h} ${points.join(' ')} ${w},${h}`} fill="var(--df-primary-soft)" stroke="none" />
      <polyline points={points.join(' ')} fill="none" stroke="var(--df-primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
