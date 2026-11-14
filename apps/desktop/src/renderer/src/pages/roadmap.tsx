import { hasFeature, lowestPlanWithFeature } from '@delyforge/shared';
import { ArrowLeft, Check, Compass, Lock } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { Page } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, IconTile } from '@/components/ui/misc';
import { useEntitlements } from '@/lib/entitlements';
import { ALL_NAV_ITEMS } from '@/navigation';

/** Honest page for planned features: what it will do, when, and which plan includes it. */
export function RoadmapPage() {
  const { pathname } = useLocation();
  const item = ALL_NAV_ITEMS.find((i) => i.path === pathname && !i.available);
  const entitlements = useEntitlements();

  if (!item) {
    return (
      <Page route={pathname}>
        <EmptyState icon={Compass} title="Page not found" description="This page doesn’t exist.">
          <Button asChild>
            <Link to="/">
              <ArrowLeft /> Back to dashboard
            </Link>
          </Button>
        </EmptyState>
      </Page>
    );
  }

  const plan = item.feature ? lowestPlanWithFeature(item.feature) : null;
  const locked = item.feature ? !hasFeature(entitlements, item.feature) : false;

  return (
    <Page route={pathname} width="narrow">
      <Card className="relative overflow-hidden p-8">
        <div className="pointer-events-none absolute inset-0" style={{ background: 'var(--df-glow)' }} />
        <div className="relative">
          <IconTile icon={item.icon} size="lg" />
          <div className="mt-4 flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-fg">{item.label}</h1>
            <Badge tone="primary">Planned · Phase {item.phase}</Badge>
            {plan && locked ? (
              <Badge tone="neutral">
                <Lock /> {plan.name} plan
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 max-w-lg text-sm text-fg-muted">{item.summary}</p>

          {item.planned?.length ? (
            <ul className="mt-6 grid grid-cols-2 gap-2">
              {item.planned.map((p) => (
                <li key={p} className="flex gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-xs text-fg-muted">
                  <Check className="mt-px size-3.5 shrink-0 text-primary" strokeWidth={2.25} />
                  {p}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-6 text-xs text-fg-subtle">
            This feature isn’t built yet. You’re seeing it because Roadmap preview is on in Settings.
          </p>
        </div>
      </Card>
    </Page>
  );
}
