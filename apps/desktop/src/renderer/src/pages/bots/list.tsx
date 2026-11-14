import { DEFAULT_PLANS, isWithinLimit } from '@delyforge/shared';
import { Bot, Plus, Search, SearchX, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BotCard } from '@/components/bots/bot-card';
import { useBotActions } from '@/components/bots/use-bot-actions';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useEntitlements } from '@/lib/entitlements';
import { useBots } from '@/lib/queries';

type Show = 'all' | 'favorites';
type Sort = 'updated' | 'name' | 'created';

export function BotsPage() {
  const bots = useBots();
  const entitlements = useEntitlements();
  const { actions, confirmDialog, importing } = useBotActions();
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [group, setGroup] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('updated');

  const all = bots.data ?? [];
  const max = entitlements.limits.maxBotProjects;
  const canAdd = isWithinLimit(entitlements, 'maxBotProjects', all.length + 1);
  const plan = DEFAULT_PLANS[entitlements.effectivePlanId];
  const groups = useMemo(
    () => [...new Set(all.map((b) => b.groupName).filter((g): g is string => g !== null))].sort((a, b) => a.localeCompare(b)),
    [all],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all.filter(
      (b) =>
        (show === 'all' || b.isFavorite) &&
        (group === null || b.groupName === group) &&
        (q === '' || b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q) || (b.groupName ?? '').toLowerCase().includes(q)),
    );
    const sorted = [...list].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
    );
    // Favorites always float to the top.
    return sorted.sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite));
  }, [all, query, show, group, sort]);

  const newButton = canAdd ? (
    <Button variant="primary" asChild>
      <Link to="/bots/new">
        <Plus /> New bot
      </Link>
    </Button>
  ) : (
    <Tooltip content={`Your ${plan.name} plan includes ${max} bot project${max === 1 ? '' : 's'}.`}>
      <span>
        <Button variant="primary" disabled>
          <Plus /> New bot
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Page route="/bots" ready={!bots.isLoading}>
      <PageHeader
        title="My Bots"
        description={
          max === null
            ? `${all.length} bot project${all.length === 1 ? '' : 's'}`
            : `${all.length} of ${max} bot project${max === 1 ? '' : 's'} on the ${plan.name} plan`
        }
        actions={
          <>
            <Button onClick={actions.importFromFile} disabled={importing || !canAdd}>
              <Upload /> Import
            </Button>
            {newButton}
          </>
        }
      />

      {!canAdd && all.length > 0 ? (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-primary-border bg-primary-soft px-4 py-3">
          <p className="text-xs text-fg-muted">
            You’ve reached your plan’s limit of {max} bot project{max === 1 ? '' : 's'}. Existing projects keep working —
            upgrade to add more.
          </p>
          <Button size="sm" asChild>
            <Link to="/subscription">View plans</Link>
          </Button>
        </div>
      ) : null}

      {bots.isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : bots.isError ? (
        <Card className="p-4 text-sm text-danger">Could not load your bots: {(bots.error as Error).message}</Card>
      ) : all.length === 0 ? (
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0" style={{ background: 'var(--df-glow)' }} />
          <EmptyState
            className="relative py-16"
            icon={Bot}
            title="Create your first bot"
            description="A bot project holds everything about one Discord bot — its modules, commands and automations."
          >
            <div className="flex gap-2">
              <Button variant="primary" asChild>
                <Link to="/bots/new">
                  <Plus /> Create bot
                </Link>
              </Button>
              <Button onClick={actions.importFromFile} disabled={importing}>
                <Upload /> Import project
              </Button>
            </div>
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
              <Input
                aria-label="Search bots"
                placeholder="Search bots…"
                className="h-8 pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Segmented
              ariaLabel="Show"
              value={show}
              onChange={setShow}
              options={[
                { value: 'all', label: 'All' },
                { value: 'favorites', label: 'Favorites' },
              ]}
            />
            <Segmented
              ariaLabel="Sort by"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'updated', label: 'Recent' },
                { value: 'name', label: 'Name' },
                { value: 'created', label: 'Newest' },
              ]}
            />
            {groups.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {[null, ...groups].map((g) => (
                  <button
                    key={g ?? '__all'}
                    type="button"
                    aria-pressed={group === g}
                    onClick={() => setGroup(g)}
                    className={cn(
                      'h-7 rounded-full border px-2.5 text-xs transition-colors',
                      group === g
                        ? 'border-primary-border bg-primary-soft text-primary'
                        : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                    )}
                  >
                    {g ?? 'All groups'}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {visible.length === 0 ? (
            <Card>
              <EmptyState icon={SearchX} title="No bots match" description="Try a different search or filter.">
                <Button
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setShow('all');
                    setGroup(null);
                  }}
                >
                  Clear filters
                </Button>
              </EmptyState>
            </Card>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {visible.map((bot) => (
                <BotCard key={bot.id} bot={bot} actions={actions} canAdd={canAdd} />
              ))}
            </div>
          )}
        </>
      )}
      {confirmDialog}
    </Page>
  );
}
