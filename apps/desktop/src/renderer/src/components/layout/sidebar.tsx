import { DEFAULT_PLANS, hasFeature, lowestPlanWithFeature } from '@delyforge/shared';
import { Lock } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useEntitlements } from '@/lib/entitlements';
import { useDashboardSummary, useSettings } from '@/lib/queries';
import { type NavItem, navItemForPath, visibleSections } from '@/navigation';

function SidebarLink({ item, badge }: { item: NavItem; badge?: number }) {
  const entitlements = useEntitlements();
  const locked = item.feature ? !hasFeature(entitlements, item.feature) : false;
  const unlockPlan = item.feature ? lowestPlanWithFeature(item.feature) : null;
  const Icon = item.icon;
  const { pathname } = useLocation();
  // Detail pages (e.g. /bots/<id>) highlight their section; /bots/new highlights "Create Bot", not "My Bots".
  const isActive = navItemForPath(pathname)?.id === item.id;

  const link = (
    <Link
      to={item.path}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
          'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-100',
          isActive
            ? 'bg-surface-hover text-fg before:absolute before:top-1.5 before:bottom-1.5 before:-left-3 before:w-0.5 before:rounded-full before:bg-primary'
            : 'text-fg-muted hover:bg-surface-hover/60 hover:text-fg',
          !item.available && 'text-fg-subtle',
        )}
    >
        <>
          <Icon
            strokeWidth={1.75}
            className={cn('size-4 shrink-0', isActive ? 'text-primary' : 'text-fg-subtle group-hover:text-fg-muted')}
          />
          <span className="truncate">{item.label}</span>
          {badge ? (
            <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-2xs font-semibold text-primary-fg tabular-nums">
              {badge > 99 ? '99+' : badge}
            </span>
          ) : locked && unlockPlan ? (
            <span className="ml-auto inline-flex items-center gap-1 text-2xs font-medium text-fg-subtle">
              <Lock className="size-3" />
              {unlockPlan.name}
            </span>
          ) : !item.available ? (
            <span className="ml-auto rounded border border-border px-1 text-2xs text-fg-subtle">Soon</span>
          ) : null}
        </>
    </Link>
  );

  if (!item.available) {
    return (
      <Tooltip side="right" content={`Planned for Phase ${item.phase}`}>
        {link}
      </Tooltip>
    );
  }
  return link;
}

export function Sidebar() {
  const { data: settings } = useSettings();
  const sections = visibleSections(settings?.showRoadmapPreview ?? false);
  const entitlements = useEntitlements();
  const plan = DEFAULT_PLANS[entitlements.effectivePlanId];
  const unread = useDashboardSummary().data?.unreadNotifications ?? 0;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-subtle">
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pt-3 pb-4">
        {sections.map((section) => (
          <div key={section.id} className="mb-4">
            <div className="px-2.5 pb-1.5 text-2xs font-medium tracking-[0.06em] text-fg-subtle uppercase">
              {section.label}
            </div>
            <div className="flex flex-col gap-px">
              {section.items.map((item) => (
                <SidebarLink key={item.id} item={item} badge={item.id === 'notifications' ? unread : undefined} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        {entitlements.source === 'personal' ? (
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-xs font-medium text-fg">Personal edition</div>
            <div className="mt-1 text-2xs text-fg-subtle">Everything unlocked · runs on this PC</div>
          </div>
        ) : (
        <NavLink
          to="/subscription"
          className="block rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-fg">{plan.name} plan</span>
            <span className="rounded border border-border px-1 text-2xs text-fg-subtle">{entitlements.source === 'account' ? 'Account' : entitlements.source === 'dev-override' ? 'Dev' : 'Local'}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-2xs">
            <span className="text-fg-subtle">
              {plan.limits.maxBotProjects === null
                ? 'Unlimited bots'
                : `${plan.limits.maxBotProjects} bot project${plan.limits.maxBotProjects === 1 ? '' : 's'}`}
            </span>
            <span className="font-medium text-primary">View plans</span>
          </div>
        </NavLink>
        )}
      </div>
    </aside>
  );
}
