import { BRAND, type Theme } from '@delyforge/shared';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Page, PageHeader } from '@/components/layout/page';
import { BackupsCard } from '@/components/settings/backups-card';
import { UpdatesRow } from '@/components/settings/updates-row';
import { Card, CardHeader } from '@/components/ui/card';
import { Separator, Skeleton } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/cn';
import { useAppInfo, useSettings, useUpdateSettings } from '@/lib/queries';

const THEMES: { value: Theme; label: string; icon: typeof Moon }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
];

function ThemePreview({ variant }: { variant: Theme }) {
  const half = (dark: boolean) => (
    <div className={cn('flex h-full flex-1 gap-1 p-1.5', dark ? 'bg-[#0c0c12]' : 'bg-[#f5f5f9]')}>
      <div className={cn('w-1/4 rounded-sm', dark ? 'bg-[#17171f]' : 'bg-white')} />
      <div className="flex flex-1 flex-col gap-1">
        <div className={cn('h-1.5 w-2/3 rounded-full', dark ? 'bg-[#2e2e3a]' : 'bg-[#d6d6e1]')} />
        <div className={cn('flex-1 rounded-sm', dark ? 'bg-[#17171f]' : 'bg-white')} />
        <div className="h-1.5 w-1/3 rounded-full bg-[#7c5cff]" />
      </div>
    </div>
  );
  return (
    <div className="flex h-16 overflow-hidden rounded-md border border-border">
      {variant === 'light' ? half(false) : variant === 'dark' ? half(true) : (
        <>
          {half(true)}
          {half(false)}
        </>
      )}
    </div>
  );
}

function Row({ title, description, control }: { title: string; description: ReactNode; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <div>
        <div className="text-sm font-medium text-fg">{title}</div>
        <div className="mt-0.5 text-xs text-fg-subtle">{description}</div>
      </div>
      {control}
    </div>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const info = useAppInfo();
  const s = settings.data;

  return (
    <Page route="/settings" ready={Boolean(s) && Boolean(info.data)} width="narrow">
      <PageHeader title="Settings" description="Personalize DelyForge. Changes are saved automatically." />

      <div className="space-y-4">
        <Card>
          <CardHeader title="Appearance" description="Choose how DelyForge looks. System follows your Windows setting." />
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3 px-5 pb-5">
            {THEMES.map((t) => {
              const selected = s?.theme === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!s}
                  onClick={() => update.mutate({ theme: t.value })}
                  className={cn(
                    'rounded-lg border p-2 text-left transition-colors',
                    selected ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong',
                  )}
                >
                  <ThemePreview variant={t.value} />
                  <div className="mt-2 flex items-center justify-between px-0.5">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg">
                      <t.icon className="size-3.5 text-fg-muted" strokeWidth={1.75} />
                      {t.label}
                    </span>
                    {selected ? <Check className="size-3.5 text-primary" strokeWidth={2.5} /> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Accessibility & preview" />
          <Separator />
          <Row
            title="Reduce motion"
            description="Turn off animations and transitions. DelyForge also respects your Windows setting."
            control={
              <Switch
                aria-label="Reduce motion"
                checked={s?.reduceMotion ?? false}
                disabled={!s}
                onCheckedChange={(v) => update.mutate({ reduceMotion: v })}
              />
            }
          />
          <Separator />
          <Row
            title="Roadmap preview"
            description="Show planned features in the sidebar. Each one opens a page describing what’s coming and when."
            control={
              <Switch
                aria-label="Roadmap preview"
                checked={s?.showRoadmapPreview ?? false}
                disabled={!s}
                onCheckedChange={(v) => update.mutate({ showRoadmapPreview: v })}
              />
            }
          />
        </Card>

        <Card>
          <CardHeader title="Running in the background" description="Bots only run while DelyForge is running on this PC." />
          <Separator />
          <Row
            title="Keep bots running when I close the window"
            description="DelyForge moves to the tray by the clock instead of quitting. Right-click its icon there to quit."
            control={
              <Switch
                aria-label="Keep bots running when I close the window"
                checked={s?.runInBackground ?? true}
                disabled={!s}
                onCheckedChange={(v) => update.mutate({ runInBackground: v })}
              />
            }
          />
          <Separator />
          <Row
            title="Start DelyForge when Windows starts"
            description="Opens quietly in the tray, so bots set to start automatically come online after a restart. Works in the installed app."
            control={
              <Switch
                aria-label="Start DelyForge when Windows starts"
                checked={s?.startWithWindows ?? false}
                disabled={!s}
                onCheckedChange={(v) => update.mutate({ startWithWindows: v })}
              />
            }
          />
        </Card>

        <Card>
          <CardHeader title="Notifications" description="Choose what DelyForge tells you about. Everything is also kept in the Notifications inbox." />
          {(
            [
              ['crashes', 'Crashes & login problems', 'A bot stopped unexpectedly, keeps crashing, or Discord rejected its token.'],
              ['disconnects', 'Lasting disconnects', 'A bot lost its connection to Discord for more than a minute.'],
              ['restarts', 'Automatic restarts', 'A crashed bot was restarted and is back online.'],
              ['highMemory', 'High memory use', 'A bot is using more than 512 MB of memory.'],
              ['desktop', 'Windows notifications', 'Also show a pop-up in the corner of your screen.'],
            ] as const
          ).map(([key, title, description]) => (
            <div key={key}>
              <Separator />
              <Row
                title={title}
                description={description}
                control={
                  <Switch
                    aria-label={title}
                    checked={s?.notifications[key] ?? true}
                    disabled={!s}
                    onCheckedChange={(v) => s && update.mutate({ notifications: { ...s.notifications, [key]: v } })}
                  />
                }
              />
            </div>
          ))}
        </Card>

        <BackupsCard />

        <Card>
          <CardHeader title="About" description={`${BRAND.productName} — ${BRAND.byline}. ${BRAND.tagline}`} />
          <Separator />
          <dl className="grid grid-cols-[160px_1fr] gap-y-2.5 px-5 py-4 text-sm">
            {info.data ? (
              (
                [
                  ['Version', info.data.version],
                  ['Platform', `${info.data.platform} (${info.data.arch})`],
                  ['Electron', info.data.electron],
                  ['Chromium', info.data.chrome],
                  ['Node.js', info.data.node],
                  ['Data folder', info.data.dataDirectory],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-fg-subtle">{k}</dt>
                  <dd className="truncate font-mono text-xs leading-5 text-fg-muted" data-selectable title={v}>
                    {v}
                  </dd>
                </div>
              ))
            ) : (
              <Skeleton className="col-span-2 h-24" />
            )}
          </dl>
          <UpdatesRow />
        </Card>
      </div>
    </Page>
  );
}
