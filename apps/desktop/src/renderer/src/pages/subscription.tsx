import { DEFAULT_PLANS, type PlanDefinition, formatUsd } from '@delyforge/shared';
import { Check, Info } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useAccount, useInvalidateAccount, useInvoices } from '@/lib/account';
import { call } from '@/lib/bridge';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { useEntitlements } from '@/lib/entitlements';

type Interval = 'month' | 'year';

function PlanCard({ plan, interval, current, action }: { plan: PlanDefinition; interval: Interval; current: boolean; action: ReactNode }) {
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
          action
        )}
      </div>
    </Card>
  );
}

export function SubscriptionPage() {
  const [interval, setInterval] = useState<Interval>('month');
  const entitlements = useEntitlements();
  const account = useAccount();
  const signedIn = account.data?.signedIn ?? false;
  const subscribed = entitlements.source === 'account' && entitlements.subscribedPlanId !== 'free';
  const invoices = useInvoices(signedIn);
  const invalidate = useInvalidateAccount();
  const checkout = useMutation({
    mutationFn: (planId: 'pro' | 'business') => call((b) => b.billing.checkout({ planId, interval })),
    onSuccess: () => toast.success('Checkout opened in your browser', { description: 'Come back here when you’ve paid — your plan updates automatically.' }),
    onError: (e: Error) => toast.error('Couldn’t open checkout', { description: e.message }),
  });
  const portal = useMutation({
    mutationFn: () => call((b) => b.billing.portal()),
    onError: (e: Error) => toast.error('Couldn’t open billing', { description: e.message }),
  });
  const plans = Object.values(DEFAULT_PLANS).sort((a, b) => a.rank - b.rank);

  // After paying in the browser, re-check the plan when the user comes back to the app.
  useEffect(() => {
    if (!signedIn) return;
    const onFocus = () => void call((b) => b.account.refresh()).then(invalidate).catch(() => null);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const actionFor = (p: PlanDefinition): ReactNode => {
    const featured = p.id === 'pro';
    if (p.pricing === null) {
      return (
        <Button className="w-full" disabled>
          Contact sales — coming soon
        </Button>
      );
    }
    if (p.id === 'free') return <Button className="w-full" disabled>{subscribed ? 'Included' : 'Free forever'}</Button>;
    if (!signedIn) {
      return (
        <Button className="w-full" variant={featured ? 'primary' : 'secondary'} asChild>
          <Link to="/account">Sign in to upgrade</Link>
        </Button>
      );
    }
    if (subscribed) {
      return (
        <Button className="w-full" onClick={() => portal.mutate()} disabled={portal.isPending}>
          Change plan
        </Button>
      );
    }
    return (
      <Button className="w-full" variant={featured ? 'primary' : 'secondary'} disabled={checkout.isPending} onClick={() => checkout.mutate(p.id as 'pro' | 'business')}>
        Upgrade to {p.name}
      </Button>
    );
  };

  return (
    <Page route="/subscription">
      <PageHeader
        title="Subscription"
        description="Simple plans that grow with your community. Your projects are never deleted if you change plans."
        actions={
          <>
            {subscribed ? (
              <Button onClick={() => portal.mutate()} disabled={portal.isPending}>
                Manage billing
              </Button>
            ) : null}
            <Segmented
              ariaLabel="Billing interval"
              value={interval}
              onChange={setInterval}
              options={[
                { value: 'month', label: 'Monthly' },
                { value: 'year', label: 'Annual · 2 months free' },
              ]}
            />
          </>
        }
      />

      {!signedIn ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-info/25 bg-info-soft px-4 py-3 text-xs text-fg-muted">
          <Info className="mt-px size-4 shrink-0 text-info" strokeWidth={1.75} />
          <p>
            You’re using DelyForge on the <span className="font-medium text-fg">Free</span> plan. <Link to="/account" className="text-primary hover:underline">Sign in or create an account</Link> to upgrade.
            Payments are handled securely by Stripe — DelyForge never sees your card.
          </p>
        </div>
      ) : entitlements.reason === 'grace_period' ? (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-fg-muted">
          Your last payment didn’t go through. Your plan keeps working until {entitlements.graceEndsAt ? new Date(entitlements.graceEndsAt).toLocaleDateString() : 'soon'} — update your card in “Manage billing”.
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-3">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} interval={interval} current={p.id === entitlements.effectivePlanId} action={actionFor(p)} />
        ))}
      </div>

      {signedIn && invoices.data?.length ? (
        <Card className="mt-4">
          <CardHeader title="Billing history" />
          <CardBody>
            <table className="w-full text-sm">
              <tbody>
                {invoices.data.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0">
                    <td className="py-2 text-fg-muted">{new Date(inv.createdAt).toLocaleDateString()}</td>
                    <td className="py-2 text-fg">{inv.number ?? inv.id}</td>
                    <td className="py-2 text-fg tabular-nums">{formatUsd(inv.amountCents)}</td>
                    <td className="py-2"><Badge tone={inv.status === 'paid' ? 'success' : 'neutral'}>{inv.status}</Badge></td>
                    <td className="py-2 text-right">
                      {inv.hostedUrl ? (
                        <Button size="sm" variant="ghost" onClick={() => void call((b) => b.shell.openExternal(inv.hostedUrl!))}>
                          View
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      ) : null}
    </Page>
  );
}
