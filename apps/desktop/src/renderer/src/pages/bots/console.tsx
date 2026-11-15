import { type LogLevel, PERSONAL_EDITION } from '@delyforge/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, Download, Search, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { TroubleshootDialog } from '@/components/ai/troubleshoot-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { call } from '@/lib/bridge';
import { useEntitlements } from '@/lib/entitlements';
import { runtimeKeys, useBotLogs } from '@/lib/runtime';
import { useBotContext } from './layout';
import { LEVEL_STYLES } from './overview';

type LevelFilter = 'all' | 'warn' | 'error';

const LEVEL_TAG: Record<LogLevel, string> = { debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR' };

/** Live console: streams in real time, with search, level filter, download and clear. */
export function BotConsole() {
  const { bot } = useBotContext();
  const qc = useQueryClient();
  const logs = useBotLogs(bot.id);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [follow, setFollow] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [askAi, setAskAi] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const retentionDays = useEntitlements().limits.logRetentionDays;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (logs.data ?? []).filter(
      (l) =>
        (level === 'all' || (level === 'warn' ? l.level === 'warn' || l.level === 'error' : l.level === 'error')) &&
        (q === '' || l.message.toLowerCase().includes(q)),
    );
  }, [logs.data, query, level]);

  useEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [visible, follow]);

  const download = () =>
    call((b) => b.logs.exportToFile(bot.id))
      .then((r) => r.saved && toast.success('Logs saved', { description: r.fileName ?? undefined }))
      .catch((e: Error) => toast.error('Could not save logs', { description: e.message }));

  const clear = () =>
    call((b) => b.logs.clear(bot.id))
      .then(() => {
        qc.setQueryData(runtimeKeys.logs(bot.id), []);
        setConfirmClear(false);
        toast.success('Console cleared');
      })
      .catch((e: Error) => toast.error('Could not clear logs', { description: e.message }));

  const errorCount = (logs.data ?? []).filter((l) => l.level === 'error').length;

  return (
    <div data-route-ready={!logs.isLoading ? `/bots/${bot.id}/console` : undefined}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input aria-label="Search logs" placeholder="Search logs…" className="h-8 pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Segmented
          ariaLabel="Level"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'all', label: 'All' },
            { value: 'warn', label: 'Warnings' },
            { value: 'error', label: `Errors${errorCount ? ` (${errorCount})` : ''}` },
          ]}
        />
        <div className="ml-auto flex items-center gap-1.5">
          {PERSONAL_EDITION ? null : (
            <Button size="sm" onClick={() => setAskAi(true)}>
              <Sparkles /> Ask AI
            </Button>
          )}
          <Button size="sm" variant={follow ? 'secondary' : 'ghost'} aria-pressed={follow} onClick={() => setFollow(!follow)}>
            <ArrowDownToLine /> Auto-scroll
          </Button>
          <Button size="sm" onClick={download}>
            <Download /> Download
          </Button>
          <Button size="sm" onClick={() => setConfirmClear(true)}>
            <Trash2 /> Clear
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div
          ref={scroller}
          onWheel={(e) => e.deltaY < 0 && follow && setFollow(false)}
          className="h-[calc(100vh-330px)] min-h-72 overflow-y-auto bg-bg-subtle p-4 font-mono text-xs leading-5"
          data-selectable
          role="log"
          aria-live="polite"
        >
          {visible.map((l) => (
            <div key={l.id} className={cn('flex gap-3 rounded px-1 hover:bg-surface-hover/60', l.level === 'error' && 'bg-danger-soft/50')}>
              <span className="shrink-0 text-fg-subtle tabular-nums">{new Date(l.createdAt).toLocaleTimeString()}</span>
              <span className={cn('shrink-0 font-semibold', LEVEL_STYLES[l.level])}>{LEVEL_TAG[l.level]}</span>
              <span className={cn('break-all whitespace-pre-wrap', l.level === 'info' ? 'text-fg' : LEVEL_STYLES[l.level])}>{l.message}</span>
            </div>
          ))}
          {visible.length === 0 ? (
            <div className="text-fg-subtle">
              {(logs.data?.length ?? 0) === 0 ? 'No output yet. Start the bot and its activity will stream here live.' : 'No lines match your filters.'}
            </div>
          ) : null}
        </div>
      </Card>
      <p className="mt-2 text-2xs text-fg-subtle">
        Tokens and secrets are automatically hidden. Logs are kept for {retentionDays} day{retentionDays === 1 ? '' : 's'} on
        your plan and capped at 5,000 lines per bot.
      </p>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear the console?"
        description="All saved log lines for this bot will be deleted. Download them first if you might need them."
        confirmLabel="Clear logs"
        onConfirm={clear}
      />
      {askAi ? <TroubleshootDialog botId={bot.id} onClose={() => setAskAi(false)} /> : null}
    </div>
  );
}
