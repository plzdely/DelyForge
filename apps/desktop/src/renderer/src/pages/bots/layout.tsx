import { type BotProject, isWithinLimit } from '@delyforge/shared';
import { ArrowLeft, Bot, Star } from 'lucide-react';
import { createContext, useContext, useMemo } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { BotIdentityAvatar } from '@/components/bots/bot-avatar';
import { BotActionsMenu } from '@/components/bots/bot-card';
import { BotControls, BotStatusLine } from '@/components/bots/runtime-ui';
import { useBotActions } from '@/components/bots/use-bot-actions';
import { Page } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { useEntitlements } from '@/lib/entitlements';
import { useBot, useBots } from '@/lib/queries';

interface BotContextValue {
  bot: BotProject;
  groups: string[];
  actions: ReturnType<typeof useBotActions>['actions'];
}

const BotContext = createContext<BotContextValue | null>(null);

export function useBotContext(): BotContextValue {
  const ctx = useContext(BotContext);
  if (!ctx) throw new Error('useBotContext must be used inside BotLayout');
  return ctx;
}

const TABS = [
  { to: '', label: 'Overview', end: true },
  { to: 'console', label: 'Console', end: false },
  { to: 'settings', label: 'Settings', end: false },
];

export function BotLayout() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const bot = useBot(id);
  const bots = useBots();
  const entitlements = useEntitlements();
  const { actions, confirmDialog } = useBotActions({ afterDelete: () => navigate('/bots') });
  const groups = useMemo(
    () => [...new Set((bots.data ?? []).map((b) => b.groupName).filter((g): g is string => g !== null))],
    [bots.data],
  );
  const canAdd = isWithinLimit(entitlements, 'maxBotProjects', (bots.data?.length ?? 0) + 1);

  if (bot.isLoading) {
    return (
      <Page route={`/bots/${id}/loading`} ready={false}>
        <Skeleton className="h-12 w-72" />
        <Skeleton className="mt-6 h-80" />
      </Page>
    );
  }

  if (bot.isError || !bot.data) {
    return (
      <Page route={`/bots/${id}`}>
        <Card>
          <EmptyState icon={Bot} title="Bot not found" description="It may have been deleted.">
            <Button asChild>
              <Link to="/bots">
                <ArrowLeft /> Back to My Bots
              </Link>
            </Button>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const b = bot.data;
  return (
    <BotContext.Provider value={{ bot: b, groups, actions }}>
      <Page route={`/bots/${id}/shell`}>
        <Link to="/bots" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-fg-subtle hover:text-fg">
          <ArrowLeft className="size-3.5" /> My Bots
        </Link>

        <div className="mb-5 flex items-center gap-4">
          <BotIdentityAvatar bot={b} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-fg">{b.name}</h1>
              {b.groupName ? <Badge>{b.groupName}</Badge> : null}
              <button
                type="button"
                aria-pressed={b.isFavorite}
                aria-label={b.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                onClick={() => actions.toggleFavorite(b)}
                className="rounded p-1 text-fg-subtle hover:text-warning"
              >
                <Star className={cn('size-4', b.isFavorite && 'fill-warning text-warning')} />
              </button>
            </div>
            <div className="mt-1 flex items-center gap-3">
              <BotStatusLine bot={b} />
              {b.botUsername ? <span className="text-xs text-fg-subtle">@{b.botUsername}</span> : null}
            </div>
          </div>
          <BotControls bot={b} />
          <BotActionsMenu bot={b} actions={actions} canAdd={canAdd} />
        </div>

        <nav aria-label="Bot sections" className="mb-5 flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <NavLink
              key={t.label}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  '-mb-px border-b-2 px-3 pb-2.5 text-sm transition-colors',
                  isActive ? 'border-primary text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>

        <Outlet />
      </Page>
      {confirmDialog}
    </BotContext.Provider>
  );
}
