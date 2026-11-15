import { ANALYTICS_DAYS, type AnalyticsReport, hasFeature, lowestPlanWithFeature } from '@delyforge/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { call } from '@/lib/bridge';
import { useEntitlements } from '@/lib/entitlements';
import { useBots } from '@/lib/queries';

type Day = AnalyticsReport['daily'][number];
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const hours = (s: number) => (s / 3600).toFixed(1);

/** One measure per day as bars from a shared baseline; hover (or focus) a bar for its exact value. */
function DailyBars({ title, data, value, format }: { title: string; data: Day[]; value: (d: Day) => number; format: (n: number) => string }) {
  const max = Math.max(1, ...data.map(value));
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        <div className="flex h-40 items-end gap-[2px] border-b border-border" role="list" aria-label={title}>
          {data.map((d) => {
            const v = value(d);
            return (
              <div key={d.day} role="listitem" tabIndex={0} aria-label={`${shortDate(d.day)}: ${format(v)}`} className="group relative flex h-full flex-1 items-end outline-none">
                <div className="w-full rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary group-focus-visible:bg-primary" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0 }} />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-2xs whitespace-nowrap text-fg shadow-sm group-hover:block group-focus-visible:block">
                  <span className="text-fg-muted">{shortDate(d.day)}</span> · <span className="tabular-nums">{format(v)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-2xs text-fg-subtle tabular-nums">
          <span>{data[0] ? shortDate(data[0].day) : ''}</span>
          <span>{data.at(-1) ? shortDate(data.at(-1)!.day) : ''}</span>
        </div>
      </CardBody>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</p>
    </Card>
  );
}

export function AnalyticsPage() {
  const advanced = hasFeature(useEntitlements(), 'analytics.advanced');
  const bots = useBots().data ?? [];
  const [botId, setBotId] = useState<string>('');
  const [days, setDays] = useState<'7' | '30' | '90'>('7');
  const effectiveDays = advanced ? Number(days) : ANALYTICS_DAYS.basic;
  const report = useQuery({
    queryKey: ['analytics', botId, effectiveDays],
    queryFn: () => call((b) => b.analytics.report({ id: botId || null, days: effectiveDays })),
    refetchInterval: 60_000,
  });
  const exportCsv = useMutation({
    mutationFn: () => call((b) => b.analytics.exportCsv()),
    onSuccess: (r) => r.saved && toast.success('Analytics exported', { description: r.fileName ?? undefined }),
    onError: (e: Error) => toast.error('Couldn’t export', { description: e.message }),
  });
  const daily = report.data?.daily ?? [];
  const total = (f: (d: Day) => number) => daily.reduce((n, d) => n + f(d), 0);
  const upgrade = lowestPlanWithFeature('analytics.advanced')?.name ?? 'Pro';

  return (
    <Page route="/analytics" ready={!report.isLoading}>
      <PageHeader
        title="Analytics"
        description="How your bots are doing. Counted on this computer — no message content is stored."
        actions={
          <>
            <Select aria-label="Bot" className="h-8 w-44" value={botId} onChange={(e) => setBotId(e.target.value)}>
              <option value="">All bots</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
            {advanced ? (
              <>
                <Segmented ariaLabel="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
                <Button onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending}>
                  <Download /> Export CSV
                </Button>
              </>
            ) : null}
          </>
        }
      />
      {!advanced ? (
        <p className="mb-4 text-xs text-fg-muted">
          Showing the last 7 days. 90-day history, per-command stats and CSV export come with {upgrade}. <Link to="/subscription" className="text-primary hover:underline">View plans</Link>
        </p>
      ) : null}

      <div className="mb-3 grid grid-cols-4 gap-3">
        <Stat label="Hours online" value={hours(total((d) => d.onlineSeconds))} />
        <Stat label="Commands used" value={total((d) => d.commands).toLocaleString()} />
        <Stat label="Commands that failed" value={total((d) => d.errors).toLocaleString()} />
        <Stat label="Crashes" value={total((d) => d.crashes).toLocaleString()} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DailyBars title="Commands used per day" data={daily} value={(d) => d.commands} format={(n) => `${n.toLocaleString()} commands`} />
        <DailyBars title="Hours online per day" data={daily} value={(d) => d.onlineSeconds} format={(n) => `${hours(n)} h`} />
      </div>

      {advanced ? (
        <Card className="mt-3">
          <CardHeader title="Most used commands" />
          <CardBody>
            {report.data?.topCommands.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-fg-muted">
                    <th className="pb-2 font-medium">Command</th>
                    <th className="pb-2 text-right font-medium">Uses</th>
                    <th className="pb-2 text-right font-medium">Failed</th>
                    <th className="pb-2 text-right font-medium">Avg. time</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.topCommands.map((c) => (
                    <tr key={c.name} className="border-t border-border">
                      <td className="py-1.5 font-mono text-fg">/{c.name}</td>
                      <td className="py-1.5 text-right text-fg tabular-nums">{c.uses.toLocaleString()}</td>
                      <td className="py-1.5 text-right text-fg-muted tabular-nums">{c.errors.toLocaleString()}</td>
                      <td className="py-1.5 text-right text-fg-muted tabular-nums">{c.avgMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-fg-subtle">No commands used in this period yet.</p>
            )}
          </CardBody>
        </Card>
      ) : null}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-fg-muted">Show the numbers as a table</summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="pb-1 font-medium">Day</th>
              <th className="pb-1 text-right font-medium">Hours online</th>
              <th className="pb-1 text-right font-medium">Commands</th>
              <th className="pb-1 text-right font-medium">Failed</th>
              <th className="pb-1 text-right font-medium">Crashes</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.day} className="border-t border-border tabular-nums">
                <td className="py-1 text-fg">{shortDate(d.day)}</td>
                <td className="py-1 text-right text-fg">{hours(d.onlineSeconds)}</td>
                <td className="py-1 text-right text-fg">{d.commands}</td>
                <td className="py-1 text-right text-fg-muted">{d.errors}</td>
                <td className="py-1 text-right text-fg-muted">{d.crashes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Page>
  );
}
