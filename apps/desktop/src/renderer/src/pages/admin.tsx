import { type AdminUser, DEFAULT_PLANS } from '@delyforge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { useAccount } from '@/lib/account';
import { call } from '@/lib/bridge';

const fail = (title: string) => (e: Error) => toast.error(title, { description: e.message });

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-fg tabular-nums">{value}</p>
    </Card>
  );
}

/** One customer: status, plan, plan extras (overrides). */
function UserRow({ user, isAdmin, onChanged }: { user: AdminUser; isAdmin: boolean; onChanged: () => void }) {
  const [plan, setPlan] = useState<'pro' | 'business'>('pro');
  const [days, setDays] = useState('30');
  const [reason, setReason] = useState('');
  const status = useMutation({
    mutationFn: () => call((b) => b.admin.setUserStatus({ id: user.id, status: user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED', reason })),
    onSuccess: () => (setReason(''), onChanged()),
    onError: fail('Couldn’t change the account'),
  });
  const grant = useMutation({
    mutationFn: () =>
      call((b) =>
        b.admin.grant({
          workspaceId: user.workspace.id,
          grantFeatures: [...DEFAULT_PLANS[plan].features],
          limits: { ...DEFAULT_PLANS[plan].limits },
          reason,
          expiresAt: new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
        }),
      ),
    onSuccess: () => (setReason(''), onChanged(), toast.success(`Granted ${DEFAULT_PLANS[plan].name} for ${days} days`)),
    onError: fail('Couldn’t grant'),
  });
  const revoke = useMutation({ mutationFn: (id: string) => call((b) => b.admin.revoke(id)), onSuccess: onChanged, onError: fail('Couldn’t revoke') });

  return (
    <li className="space-y-2 border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-fg">{user.displayName}</span>
        <span className="text-fg-muted">{user.email}</span>
        {!user.emailVerified ? <Badge>unconfirmed</Badge> : null}
        {user.role !== 'USER' ? <Badge tone="primary">{user.role.toLowerCase()}</Badge> : null}
        <Badge tone={user.status === 'ACTIVE' ? 'success' : 'danger'}>{user.status.toLowerCase()}</Badge>
        <Badge>{user.workspace.planId}{user.workspace.subscriptionStatus ? ` · ${user.workspace.subscriptionStatus.toLowerCase()}` : ''}</Badge>
        <span className="ml-auto text-2xs text-fg-subtle">joined {new Date(user.createdAt).toLocaleDateString()}</span>
      </div>
      {user.overrides.map((o) => (
        <div key={o.id} className="flex items-center gap-2 pl-2 text-xs text-fg-muted">
          <span>Extra: {o.grantFeatures.length} features · {o.reason}{o.expiresAt ? ` · until ${new Date(o.expiresAt).toLocaleDateString()}` : ''}</span>
          {isAdmin ? <Button size="sm" variant="ghost" onClick={() => revoke.mutate(o.id)}>Revoke</Button> : null}
        </div>
      ))}
      {isAdmin ? (
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-end gap-2">
          <Field label="Reason (saved in the audit log)" htmlFor={`r-${user.id}`}><Input id={`r-${user.id}`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Give plan" htmlFor={`p-${user.id}`}>
            <Select id={`p-${user.id}`} value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)}>
              <option value="pro">Pro</option>
              <option value="business">Business</option>
            </Select>
          </Field>
          <Field label="Days" htmlFor={`d-${user.id}`}><Input id={`d-${user.id}`} className="w-20" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
          <Button disabled={reason.trim().length < 3 || grant.isPending} onClick={() => grant.mutate()}>Grant</Button>
          <Button variant={user.status === 'SUSPENDED' ? 'secondary' : 'danger'} disabled={reason.trim().length < 3 || status.isPending} onClick={() => status.mutate()}>
            {user.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function ListingModeration() {
  const [slug, setSlug] = useState('');
  const [reason, setReason] = useState('');
  const set = useMutation({
    mutationFn: (status: 'PUBLISHED' | 'SUSPENDED') => call((b) => b.admin.setListingStatus({ slug, status, reason })),
    onSuccess: (_d, s) => toast.success(s === 'SUSPENDED' ? 'Listing suspended' : 'Listing published'),
    onError: fail('Couldn’t change the listing'),
  });
  return (
    <Card className="mt-3">
      <CardHeader title="Marketplace listing" description="Suspend a listing (hidden, no installs, no new versions) or put it back. Reviews can be hidden from the listing itself." />
      <CardBody className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2">
        <Field label="Listing address" htmlFor="adm-slug"><Input id="adm-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /></Field>
        <Field label="Reason" htmlFor="adm-lreason"><Input id="adm-lreason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Button variant="danger" disabled={!slug || reason.trim().length < 3 || set.isPending} onClick={() => set.mutate('SUSPENDED')}>Suspend</Button>
        <Button disabled={!slug || reason.trim().length < 3 || set.isPending} onClick={() => set.mutate('PUBLISHED')}>Republish</Button>
      </CardBody>
    </Card>
  );
}

export function AdminPage() {
  const qc = useQueryClient();
  const role = useAccount().data?.profile?.role;
  const staff = role === 'ADMIN' || role === 'SUPPORT';
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => call((b) => b.admin.overview()), enabled: staff });
  const users = useQuery({ queryKey: ['admin', 'users', search], queryFn: () => call((b) => b.admin.users(search)), enabled: staff && search.length > 0 });
  const audit = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => call((b) => b.admin.audit()), enabled: staff });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] });

  if (!staff) {
    return (
      <Page route="/admin" width="narrow">
        <PageHeader title="Admin" />
        <Card><EmptyState icon={ShieldAlert} title="DelyForge staff only" description="This area is for the DelyForge team." /></Card>
      </Page>
    );
  }
  const o = overview.data;
  return (
    <Page route="/admin" ready={!overview.isLoading}>
      <PageHeader title="Admin" description={`Signed in as ${role === 'ADMIN' ? 'an admin' : 'support (read-only)'}. Every change is recorded in the audit log.`} />
      {o ? (
        <div className="mb-3 grid grid-cols-4 gap-3">
          <Stat label="Accounts (new this week)" value={`${o.users} (${o.newUsers7d})`} />
          <Stat label="Paying: Pro / Business / Enterprise" value={`${o.subscriptions.pro} / ${o.subscriptions.business} / ${o.subscriptions.enterprise}`} />
          <Stat label="AI this month (credits · our cost)" value={`${o.aiCreditsThisMonth} · $${(o.aiCostCentsThisMonth / 100).toFixed(2)}`} />
          <Stat label="Marketplace (live · awaiting review)" value={`${o.publishedListings} · ${o.pendingReviews}`} />
        </div>
      ) : overview.error ? <p className="mb-3 text-sm text-danger">{overview.error.message}</p> : null}

      <Card>
        <CardHeader title="Customers" />
        <CardBody>
          <form className="mb-2 flex gap-2" onSubmit={(e) => (e.preventDefault(), setSearch(q.trim()))}>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
              <Input aria-label="Search customers" placeholder="Email, name or ID" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Button type="submit" disabled={!q.trim()}>Search</Button>
          </form>
          {users.data && !users.data.length ? <p className="text-sm text-fg-subtle">No customers match.</p> : null}
          <ul>{(users.data ?? []).map((u) => <UserRow key={u.id} user={u} isAdmin={role === 'ADMIN'} onChanged={refresh} />)}</ul>
        </CardBody>
      </Card>

      {role === 'ADMIN' ? <ListingModeration /> : null}

      <Card className="mt-3">
        <CardHeader title="Audit log" description="The latest 200 recorded actions." />
        <CardBody>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {(audit.data ?? []).map((e) => (
                  <tr key={e.id} className="border-t border-border align-top">
                    <td className="py-1 pr-3 whitespace-nowrap text-fg-subtle tabular-nums">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="py-1 pr-3 font-mono text-fg">{e.action}</td>
                    <td className="py-1 pr-3 text-fg-muted">{e.actor ?? 'system'}</td>
                    <td className="py-1 break-all text-fg-subtle" data-selectable>{JSON.stringify(e.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </Page>
  );
}
