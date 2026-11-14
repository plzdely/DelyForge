import { type ActivityItem, DEFAULT_PLANS } from '@delyforge/shared';
import { Link } from 'react-router';
import { BotAvatar } from '@/components/bots/bot-avatar';
import { BotStatus } from '@/components/bots/bot-card';
import {
  Activity,
  ArrowRight,
  Bot,
  Plus,
  Star,
  Check,
  CircleAlert,
  CreditCard,
  type LucideIcon,
  Map as MapIcon,
  Power,
  PowerOff,
  Settings2,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, IconTile, Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { useEntitlements } from '@/lib/entitlements';
import { greeting, timeAgo } from '@/lib/format';
import { useBots, useDashboardSummary, useSettings, useUpdateSettings } from '@/lib/queries';

function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  loading,
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: LucideIcon;
  tone?: 'neutral' | 'primary' | 'success';
  loading?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        <IconTile icon={icon} size="sm" tone={tone} />
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-12" />
      ) : (
        <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-fg tabular-nums">{value}</div>
      )}
      <div className="mt-0.5 text-xs text-fg-subtle">{hint}</div>
    </Card>
  );
}

interface Step {
  title: string;
  description: string;
  done: boolean;
  phase?: number;
  action?: React.ReactNode;
}

function GettingStarted({ steps }: { steps: Step[] }) {
  const completed = steps.filter((s) => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0" style={{ background: 'var(--df-glow)' }} />
      <div className="relative">
        <CardHeader
          title="Get your first bot online"
          description="DelyForge walks you through every step — no programming required."
          action={
            <span className="text-xs text-fg-subtle tabular-nums">
              {completed} of {steps.length} complete
            </span>
          }
        />
        <div className="mx-5 mb-4 h-1 overflow-hidden rounded-full bg-surface-hover">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <ol className="px-2 pb-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold tabular-nums',
                  step.done
                    ? 'border-transparent bg-primary text-primary-fg'
                    : 'border-border-strong bg-surface text-fg-subtle',
                )}
              >
                {step.done ? <Check className="size-3.5" strokeWidth={2.5} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('text-sm font-medium', step.done ? 'text-fg-muted line-through decoration-fg-subtle/50' : 'text-fg')}>
                  {step.title}
                </div>
                <div className="text-xs text-fg-subtle">{step.description}</div>
              </div>
              {step.action ??
                (!step.done && step.phase ? <Badge tone="neutral">Coming in Phase {step.phase}</Badge> : null)}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

const ACTIVITY_ICONS: Record<ActivityItem['kind'], LucideIcon> = {
  app: Sparkles,
  bot: Bot,
  module: Settings2,
  workflow: Workflow,
  account: CreditCard,
  system: CircleAlert,
};

function RecentActivity({ items, loading }: { items: ActivityItem[]; loading: boolean }) {
  return (
    <Card className="flex flex-col">
      <CardHeader title="Recent activity" description="Everything that happens across your bots." />
      <CardBody className="flex-1 pb-3">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Activity} title="No activity yet" description="Bot starts, crashes and changes will show up here." />
        ) : (
          <ul className="-mx-2">
            {items.map((item) => {
              const Icon = ACTIVITY_ICONS[item.kind] ?? Activity;
              return (
                <li key={item.id} className="flex items-start gap-3 rounded-md px-2 py-2">
                  <IconTile icon={Icon} size="sm" tone={item.kind === 'system' ? 'warning' : 'primary'} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg" data-selectable>
                      {item.message}
                    </p>
                    <p className="text-2xs text-fg-subtle">{timeAgo(item.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function YourBots() {
  const bots = useBots();
  const list = [...(bots.data ?? [])]
    .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);
  return (
    <Card className="mt-3">
      <CardHeader
        title="Your bots"
        description="Favorites first, then most recently updated."
        action={
          <Button size="sm" variant="ghost" asChild>
            <Link to="/bots">
              View all <ArrowRight />
            </Link>
          </Button>
        }
      />
      <CardBody>
        <div className="grid grid-cols-3 gap-2">
          {list.map((bot) => (
            <Link
              key={bot.id}
              to={`/bots/${bot.id}`}
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-hover/50"
            >
              <BotAvatar id={bot.id} name={bot.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-fg">{bot.name}</span>
                  {bot.isFavorite ? <Star className="size-3 shrink-0 fill-warning text-warning" /> : null}
                </div>
                <BotStatus bot={bot} />
              </div>
            </Link>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

export function DashboardPage() {
  const summary = useDashboardSummary();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const entitlements = useEntitlements();
  const plan = DEFAULT_PLANS[entitlements.effectivePlanId];
  const data = summary.data;
  const loading = summary.isLoading;
  const isNewUser = (data?.totalProjects ?? 0) === 0;
  const limit = entitlements.limits.maxBotProjects;

  const steps: Step[] = [
    { title: 'Install DelyForge', description: 'Your local workspace and database are set up.', done: true },
    {
      title: 'Explore what’s coming',
      description: 'Preview every planned builder and module in the sidebar.',
      done: settings?.showRoadmapPreview ?? false,
      action: settings?.showRoadmapPreview ? undefined : (
        <Button size="sm" onClick={() => updateSettings.mutate({ showRoadmapPreview: true })}>
          <MapIcon /> Show roadmap
        </Button>
      ),
    },
    {
      title: 'Create your first bot project',
      description: 'Give your bot a name — everything else can be set up step by step.',
      done: !isNewUser,
      action: isNewUser ? (
        <Button size="sm" variant="primary" asChild>
          <Link to="/bots/new">
            <Plus /> Create bot
          </Link>
        </Button>
      ) : undefined,
    },
    { title: 'Connect your Discord application', description: 'Securely link your bot token and invite the bot.', done: false, phase: 3 },
    { title: 'Enable modules', description: 'Moderation, welcome messages, tickets, leveling and more.', done: false, phase: 4 },
    { title: 'Start your bot', description: 'Go live and monitor it in real time.', done: false, phase: 3 },
  ];

  return (
    <Page route="/" ready={!loading && !summary.isError}>
      <PageHeader
        eyebrow={greeting()}
        title={isNewUser ? 'Welcome to DelyForge' : 'Overview'}
        description="What would you like to build today?"
      />

      {summary.isError ? (
        <Card className="mb-6 border-danger/40 p-4 text-sm text-danger">
          Could not load your dashboard: {(summary.error as Error).message}
        </Card>
      ) : null}

      <div className="grid grid-cols-4 gap-3">
        <StatCard
          label="Bot projects"
          value={data?.totalProjects ?? 0}
          hint={limit === null ? 'Unlimited on your plan' : `of ${limit} on the ${plan.name} plan`}
          icon={Bot}
          tone="primary"
          loading={loading}
        />
        <StatCard label="Online" value={data?.onlineBots ?? 0} hint="Running right now" icon={Power} tone="success" loading={loading} />
        <StatCard label="Offline" value={data?.offlineBots ?? 0} hint="Stopped or disabled" icon={PowerOff} loading={loading} />
        <StatCard
          label="Plan"
          value={plan.name}
          hint={data?.accountConnected ? 'Synced with your account' : 'Local — no account connected'}
          icon={CreditCard}
          loading={loading}
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <GettingStarted steps={steps} />
        </div>
        <RecentActivity items={data?.recentActivity ?? []} loading={loading} />
      </div>

      {!isNewUser ? <YourBots /> : null}
    </Page>
  );
}
