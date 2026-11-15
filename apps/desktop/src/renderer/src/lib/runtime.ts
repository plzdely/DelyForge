import type { AppNotification, BotLogEntry, BotRuntimeState } from '@delyforge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { call } from './bridge';
import { queryKeys } from './queries';

export const runtimeKeys = {
  states: ['runtime-states'] as const,
  logs: (id: string) => ['logs', id] as const,
  notifications: ['notifications'] as const,
};

const MAX_LOG_LINES = 2000;

/**
 * Subscribes once (in the app shell) to live events from the main process and folds them into the query cache,
 * so every screen updates instantly without polling.
 */
export function useBotEventStream(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const off = window.delyforge?.events.onBotEvent((event) => {
      switch (event.type) {
        case 'state': {
          qc.setQueryData<BotRuntimeState[]>(runtimeKeys.states, (prev) => {
            const list = prev ?? [];
            const i = list.findIndex((s) => s.botId === event.state.botId);
            if (i === -1) return [...list, event.state];
            const next = list.slice();
            next[i] = event.state;
            return next;
          });
          if (event.state.status === 'online' || event.state.status === 'offline') {
            void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
          }
          break;
        }
        case 'log':
          qc.setQueryData<BotLogEntry[]>(runtimeKeys.logs(event.entry.botId), (prev) =>
            prev ? [...prev, event.entry].slice(-MAX_LOG_LINES) : prev,
          );
          break;
        case 'project-updated':
          void qc.invalidateQueries({ queryKey: queryKeys.bots });
          break;
        case 'account-updated':
          void qc.invalidateQueries({ queryKey: ['account'] });
          void qc.invalidateQueries({ queryKey: ['entitlements'] });
          void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
          break;
        case 'notification':
          qc.setQueryData<AppNotification[]>(runtimeKeys.notifications, (prev) =>
            prev ? [event.notification, ...prev] : prev,
          );
          void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
          if (event.notification.type === 'bot.crashed' || event.notification.type === 'bot.crash_loop' || event.notification.type === 'bot.login_failed') {
            toast.error(event.notification.title, { description: event.notification.body });
          }
          break;
      }
    });
    return () => off?.();
  }, [qc]);
}

export function useRuntimeStates() {
  return useQuery({
    queryKey: runtimeKeys.states,
    queryFn: () => call((b) => b.runtime.states()),
    staleTime: Infinity, // kept fresh by the event stream
  });
}

const OFFLINE = (botId: string): BotRuntimeState => ({
  botId,
  status: 'offline',
  startedAt: null,
  readyAt: null,
  pid: null,
  lastError: null,
  metrics: null,
  history: [],
  commandsThisSession: 0,
  restartCount: 0,
  restartInSeconds: null,
});

export function useRuntimeState(botId: string): BotRuntimeState {
  const { data } = useRuntimeStates();
  return data?.find((s) => s.botId === botId) ?? OFFLINE(botId);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/** Start / stop / restart with consistent feedback. State changes arrive through the event stream. */
export function useRuntimeControls() {
  const start = useMutation({
    mutationFn: (id: string) => call((b) => b.runtime.start(id)),
    onError: (e) => toast.error('Could not start the bot', { description: errorMessage(e) }),
  });
  const stop = useMutation({
    mutationFn: (id: string) => call((b) => b.runtime.stop(id)),
    onError: (e) => toast.error('Could not stop the bot', { description: errorMessage(e) }),
  });
  const restart = useMutation({
    mutationFn: (id: string) => call((b) => b.runtime.restart(id)),
    onError: (e) => toast.error('Could not restart the bot', { description: errorMessage(e) }),
  });
  const startAll = useMutation({
    mutationFn: () => call((b) => b.runtime.startAll()),
    onSuccess: (r) =>
      r.started > 0
        ? toast.success(`Starting ${r.started} bot${r.started === 1 ? '' : 's'}`, {
            description: r.skipped ? `${r.skipped} skipped because of your plan limit.` : undefined,
          })
        : toast('No bots to start', { description: 'Connect a bot to Discord first, or they are already running.' }),
    onError: (e) => toast.error('Could not start bots', { description: errorMessage(e) }),
  });
  const stopAll = useMutation({
    mutationFn: () => call((b) => b.runtime.stopAll()),
    onSuccess: (r) => toast.success(r.stopped ? `Stopped ${r.stopped} bot${r.stopped === 1 ? '' : 's'}` : 'No bots were running'),
    onError: (e) => toast.error('Could not stop bots', { description: errorMessage(e) }),
  });
  return { start, stop, restart, startAll, stopAll };
}

export function useBotLogs(botId: string) {
  return useQuery({
    queryKey: runtimeKeys.logs(botId),
    queryFn: () => call((b) => b.logs.list(botId, 1000)),
    staleTime: Infinity,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: runtimeKeys.notifications,
    queryFn: () => call((b) => b.notifications.list()),
    staleTime: Infinity,
  });
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: runtimeKeys.notifications });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
  };
  const markRead = useMutation({ mutationFn: (ids?: number[]) => call((b) => b.notifications.markRead(ids)), onSuccess: refresh });
  const clear = useMutation({ mutationFn: () => call((b) => b.notifications.clear()), onSuccess: refresh });
  return { markRead, clear };
}

// ─── Formatting ───────────────────────────────────────────────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1048576)} MB`;
}

/** Re-renders every second while `active` so uptime counters tick. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
