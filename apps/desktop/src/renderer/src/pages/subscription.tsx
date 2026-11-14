import { DEFAULT_PLANS, type PlanDefinition, formatUsd } from '@delyforge/shared';
import { Check, Info } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useEntitlements } from '@/lib/entitlements';

type Interval = 'month' | 'year';

function PlanCard({ plan, interval, current }: { plan: PlanDefinition; interval: Interval; current: boolean }) {
  const featured = plan.id === 'pro';
  const price = plan.pricing
    ? interval === 'month'
      ? plan.pricing.monthlyUsdCents
      : Math.round(plan.pricing.annualUsdCents / 12)
    : null;

  return (
    <Card
      className={cn(
        'relative flex flex-col p-5',
        featured && 'border-primary-border shadow-[0_0_0_1px_var(--df-primary-border),0_8px_30px_-12px_var(--df-primary-soft)]',
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">{plan.name}</h3>
        {current ? <Badge tone="primary">Current plan</Badge> : featured ? <Badge tone="neutral">Most popular</Badge> : null}
      </div>
      <p className="mt-1 min-h-8 text-xs text-fg-subtle">{plan.tagline}</p>

      <div className="mt-4 flex items-baseline gap-1">
        {price === null ? (
          <span className="text-2xl font-semibold tracking-[-0.03em] text-fg">Custom</span>
        ) : (
          <>
            <span className="text-2xl font-semibold tracking-[-0.03em] text-fg tabular-nums">{formatUsd(price)}</span>
            <span className="text-xs text-fg-subtle">/ month</span>
          </>
        )}
      </div>
      <p className="mt-0.5 h-4 text-2xs text-fg-subtle">
        {plan.pricing && plan.pricing.annualUsdCents > 0 && interval === 'year'
          ? `${formatUsd(plan.pricing.annualUsdCents)} billed yearly`
          : plan.pricing && plan.pricing.monthlyUsdCents > 0
            ? 'Billed monthly'
            : ''}
      </p>

      <ul className="mt-4 flex-1 space-y-2">
        {plan.highlights.map((h) => (
          <li key={h} className="flex gap-2 text-xs text-fg-muted">
            <Check className="mt-0.5 size-3.5 shrink-0 text-primary" strokeWidth={2.25} />
            {h}
          </li>
        ))}
      </ul>

      <div className="mt-5">
        {current ? (
          <Button className="w-full" disabled>
            Your plan
          </Button>
        ) : (
          <Tooltip content="Accounts and secure checkout arrive in Phase 7 of development.">
            {/* span wrapper so the tooltip still works on a disabled button */}
            <span className="block">
              <Button className="w-full" variant={featured ? 'primary' : 'secondary'} disabled>
                {plan.pricing === null ? 'Contact sales — soon' : `Upgrade to ${plan.name} — soon`}
              </Button>
            </span>
          </Tooltip>
        )}
      </div>
    </Card>
  );
}

export function SubscriptionPage() {
  const [interval, setInterval] = useState<Interval>('month');
  const entitlements = useEntitlements();
  const plans = Object.values(DEFAULT_PLANS).sort((a, b) => a.rank - b.rank);

  return (
    <Page route="/subscription">
      <PageHeader
        title="Subscription"
        description="Simple plans that grow with your community. Your projects are never deleted if you change plans."
        actions={
          <Segmented
            ariaLabel="Billing interval"
            value={interval}
            onChange={setInterval}
            options={[
              { value: 'month', label: 'Monthly' },
              { value: 'year', label: 'Annual · 2 months free' },
            ]}
          />
        }
      />

      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-info/25 bg-info-soft px-4 py-3 text-xs text-fg-muted">
        <Info className="mt-px size-4 shrink-0 text-info" strokeWidth={1.75} />
        <p>
          You’re using DelyForge locally on the <span className="font-medium text-fg">Free</span> plan. Account sign-in
          and secure Stripe checkout are coming in a later update — prices shown are the planned launch pricing.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} interval={interval} current={p.id === entitlements.effectivePlanId} />
        ))}
      </div>
    </Page>
  );
}
