import { type ActivityItem, DEFAULT_PLANS } from '@delyforge/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BotAvatar } from '@/components/bots/bot-avatar';
import { BotStatus } from '@/components/bots/bot-card';
import {
  Activity,
  ArrowRight,
  Blocks,
  ChartColumn,
  LayoutTemplate,
  Bot,
  Play,
  Plus,
  Server,
  Square,
  SquareSlash,
  Star,
  Check,
  CircleAlert,
  CreditCard,
  type LucideIcon,
  Power,
  Settings2,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { Page } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, IconTile, Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { useEntitlements } from '@/lib/entitlements';
import { greeting, timeAgo } from '@/lib/format';
import { useBots, useDashboardSummary } from '@/lib/queries';
import { useRuntimeControls } from '@/lib/runtime';

function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  loading,
  to,
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: LucideIcon;
  tone?: 'neutral' | 'primary' | 'success' | 'info' | 'warning';
  loading?: boolean;
  to: string;
}) {
  return (
    <Link to={to} className="card-interactive block rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        <IconTile icon={icon} size="md" tone={tone} />
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-14" />
      ) : (
        <div className="mt-2 text-[28px] leading-9 font-semibold tracking-[-0.03em] text-fg tabular-nums">{value}</div>
      )}
      <div className="text-xs text-fg-subtle">{hint}</div>
    </Link>
  );
}

/** Top of the dashboard: greeting, live status and the main actions, on the brand glow. */
function Hero({ title, online, total, actions }: { title: string; online: number; total: number; actions: ReactNode }) {
  return (
    <div className="relative mb-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <div className="pointer-events-none absolute inset-0" style={{ background: 'var(--df-hero)' }} />
      <div className="relative flex items-end justify-between gap-6 px-6 py-6">
        <div>
          <p className="text-xs font-medium text-fg-muted">{greeting()}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-fg">{title}</h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-fg-muted">
            <span className={cn('size-2 rounded-full', online > 0 ? 'bg-success shadow-[0_0_10px] shadow-success/60' : 'bg-fg-subtle')} />
            {total === 0 ? 'No bots yet — create one to get started.' : `${online} of ${total} bot${total === 1 ? '' : 's'} online`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">{actions}</div>
      </div>
    </div>
  );
}

const QUICK_LINKS: { to: string; title: string; text: string; icon: LucideIcon }[] = [
  { to: '/modules', title: 'Modules', text: 'Welcome, moderation, tickets, leveling and more.', icon: Blocks },
  { to: '/templates', title: 'Bot templates', text: 'Set up a whole server in one click.', icon: LayoutTemplate },
  { to: '/builders/commands', title: 'Command Builder', text: 'Make your own slash commands — no code.', icon: SquareSlash },
  { to: '/analytics', title: 'Analytics', text: 'See what your bots have been up to.', icon: ChartColumn },
];

function QuickLinks() {
  return (
    <Card>
      <CardHeader title="What’s next?" description="Your bot is live. Here are good places to go from here." />
      <CardBody className="grid grid-cols-2 gap-2">
        {QUICK_LINKS.map((q) => (
          <Link key={q.to} to={q.to} className="card-interactive group flex items-start gap-3 rounded-lg border border-border bg-bg-subtle/40 p-3">
            <IconTile icon={q.icon} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-sm font-medium text-fg">
                {q.title} <ArrowRight className="size-3.5 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="text-xs text-fg-muted">{q.text}</p>
            </div>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}

interface Step {
  title: string;
  description: string;
  done: boolean;
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
              {step.action ?? null}
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
              className="card-interactive flex items-center gap-3 rounded-lg border border-border bg-bg-subtle/40 px-3 py-2.5"
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
  const entitlements = useEntitlements();
  const plan = DEFAULT_PLANS[entitlements.effectivePlanId];
  const data = summary.data;
  const loading = summary.isLoading;
  const isNewUser = (data?.totalProjects ?? 0) === 0;
  const limit = entitlements.limits.maxBotProjects;
  const bots = useBots().data ?? [];
  const firstBot = bots[0];
  const connected = bots.some((b) => b.hasToken);
  const firstUnconnected = bots.find((b) => !b.hasToken);
  const everStarted = (data?.onlineBots ?? 0) > 0 || bots.some((b) => b.botUsername !== null && b.guildCount > 0);
  const { startAll, stopAll } = useRuntimeControls();

  const steps: Step[] = [
    { title: 'Install DelyForge', description: 'Your local workspace and database are set up.', done: true },
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
    {
      title: 'Connect your Discord application',
      description: 'Securely link your bot token and invite the bot to your server.',
      done: connected,
      action:
        !connected && (firstUnconnected ?? firstBot) ? (
          <Button size="sm" variant="primary" asChild>
            <Link to={`/bots/${(firstUnconnected ?? firstBot)!.id}/connect`}>Connect</Link>
          </Button>
        ) : undefined,
    },
    {
      title: 'Start your bot',
      description: 'Go live, then type /ping in your server to see it answer.',
      done: everStarted,
      action:
        connected && !everStarted ? (
          <Button size="sm" variant="primary" asChild>
            <Link to={`/bots/${bots.find((b) => b.hasToken)!.id}`}>Open bot</Link>
          </Button>
        ) : undefined,
    },
  ];

  return (
    <Page route="/" ready={!loading && !summary.isError}>
      <Hero
        title={isNewUser ? 'Welcome to DelyForge' : 'Overview'}
        online={data?.onlineBots ?? 0}
        total={data?.totalProjects ?? 0}
        actions={
          connected ? (
            <>
              <Button onClick={() => stopAll.mutate()} disabled={stopAll.isPending || (data?.onlineBots ?? 0) === 0}>
                <Square className="fill-current" /> Stop all
              </Button>
              <Button variant="primary" onClick={() => startAll.mutate()} disabled={startAll.isPending}>
                <Play className="fill-current" /> Start all
              </Button>
            </>
          ) : (
            <Button variant="primary" asChild>
              <Link to="/bots/new">
                <Plus /> New bot
              </Link>
            </Button>
          )
        }
      />

      {summary.isError ? (
        <Card className="mb-6 border-danger/40 p-4 text-sm text-danger">
          Could not load your dashboard: {(summary.error as Error).message}
        </Card>
      ) : null}

      <div className="grid grid-cols-4 gap-3">
        <StatCard
          to="/bots"
          label="Bot projects"
          value={data?.totalProjects ?? 0}
          hint={limit === null ? 'No limit' : `of ${limit} on the ${plan.name} plan`}
          icon={Bot}
          tone="primary"
          loading={loading}
        />
        <StatCard to="/monitoring" label="Online" value={data?.onlineBots ?? 0} hint={`${data?.offlineBots ?? 0} offline`} icon={Power} tone="success" loading={loading} />
        <StatCard to="/bots" label="Servers" value={data?.totalServers ?? 0} hint="Across all your bots" icon={Server} tone="info" loading={loading} />
        <StatCard to="/analytics" label="Commands run" value={data?.totalCommands ?? 0} hint="All time, all bots" icon={SquareSlash} tone="warning" loading={loading} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="col-span-2">
          {steps.every((st) => st.done) ? <QuickLinks /> : <GettingStarted steps={steps} />}
        </div>
        <RecentActivity items={data?.recentActivity ?? []} loading={loading} />
      </div>

      {!isNewUser ? <YourBots /> : null}
    </Page>
  );
}
