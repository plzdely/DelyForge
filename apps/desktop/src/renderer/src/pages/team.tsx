import { TEAM_ROLES, type TeamRole, hasFeature, lowestPlanWithFeature } from '@delyforge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { accountKeys, useAccount, useInvalidateAccount } from '@/lib/account';
import { call } from '@/lib/bridge';
import { useEntitlements } from '@/lib/entitlements';

const ROLE_NAMES: Record<TeamRole, string> = { OWNER: 'Owner', ADMIN: 'Admin', DEVELOPER: 'Developer', VIEWER: 'Viewer' };
const keys = { info: ['team'] as const, invites: ['team', 'my-invites'] as const };
const fail = (title: string) => (e: Error) => toast.error(title, { description: e.message });

export function TeamPage() {
  const qc = useQueryClient();
  const account = useAccount().data;
  const invalidateAccount = useInvalidateAccount();
  const canInvitePlan = hasFeature(useEntitlements(), 'team.workspaces');
  const signedIn = account?.signedIn ?? false;
  const info = useQuery({ queryKey: keys.info, queryFn: () => call((b) => b.team.info()), enabled: signedIn });
  const myInvites = useQuery({ queryKey: keys.invites, queryFn: () => call((b) => b.team.myInvites()), enabled: signedIn });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof TEAM_ROLES)[number]>('DEVELOPER');
  const [removing, setRemoving] = useState<{ userId: string; name: string; self: boolean } | null>(null);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: keys.info });
    void qc.invalidateQueries({ queryKey: keys.invites });
    invalidateAccount();
  };
  const onSwitched = (status: unknown) => {
    qc.setQueryData(accountKeys.status, status);
    refreshAll();
  };
  const switchTo = useMutation({ mutationFn: (id: string) => call((b) => b.team.switchTo(id)), onSuccess: onSwitched, onError: fail('Couldn’t switch workspace') });
  const accept = useMutation({
    mutationFn: (id: string) => call((b) => b.team.accept(id)),
    onSuccess: (s) => (onSwitched(s), toast.success('You joined the team', { description: 'Its plan now applies on this computer.' })),
    onError: fail('Couldn’t accept the invite'),
  });
  const invite = useMutation({
    mutationFn: () => call((b) => b.team.invite({ email, role })),
    onSuccess: () => (setEmail(''), refreshAll(), toast.success('Invite sent')),
    onError: fail('Couldn’t send the invite'),
  });
  const revoke = useMutation({ mutationFn: (id: string) => call((b) => b.team.revokeInvite(id)), onSuccess: refreshAll, onError: fail('Couldn’t withdraw the invite') });
  const remove = useMutation({ mutationFn: (userId: string) => call((b) => b.team.removeMember(userId)), onSuccess: refreshAll, onError: fail('Couldn’t remove') });

  if (!signedIn) {
    return (
      <Page route="/team" width="narrow">
        <PageHeader title="Team" description="Share your plan with the people who help run your bots." />
        <Card>
          <EmptyState icon={Users} title="Sign in to use teams" description="Teams belong to DelyForge accounts.">
            <Button variant="primary" asChild><Link to="/account">Sign in</Link></Button>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const t = info.data;
  const seatsFull = t?.seats.limit !== null && t !== undefined && t.seats.used >= (t.seats.limit ?? 0);
  return (
    <Page route="/team" ready={!info.isLoading} width="narrow">
      <PageHeader title="Team" description="Team members share this workspace’s plan, bot limits and AI credits. Each person’s bots stay on their own computer." />

      {myInvites.data?.length ? (
        <Card className="mb-4">
          <CardHeader title="Invitations for you" />
          <CardBody className="space-y-2 text-sm">
            {myInvites.data.map((i) => (
              <div key={i.id} className="flex items-center gap-3">
                <span className="flex-1 text-fg">
                  {i.invitedBy} invited you to <span className="font-medium">{i.workspaceName}</span> as {ROLE_NAMES[i.role]}
                </span>
                <Button size="sm" variant="primary" disabled={accept.isPending} onClick={() => accept.mutate(i.id)}>Accept</Button>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {t && t.workspaces.length > 1 ? (
        <Card className="mb-4">
          <CardHeader title="Your workspaces" description="The active workspace’s plan applies on this computer." />
          <CardBody className="space-y-2 text-sm">
            {t.workspaces.map((w) => (
              <div key={w.id} className="flex items-center gap-3">
                <span className="flex-1 text-fg">{w.name}</span>
                <Badge>{ROLE_NAMES[w.role]}</Badge>
                {w.active ? <Badge tone="success">Active</Badge> : <Button size="sm" disabled={switchTo.isPending} onClick={() => switchTo.mutate(w.id)}>Switch</Button>}
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {t ? (
        <Card>
          <CardHeader
            title={t.workspace.name}
            description={t.seats.limit === null ? `${t.seats.used} people` : `${t.seats.used} of ${t.seats.limit} seats used (pending invites count)`}
          />
          <CardBody className="space-y-4 text-sm">
            <ul className="space-y-2">
              {t.members.map((m) => {
                const self = m.userId === account?.profile?.id;
                return (
                  <li key={m.userId} className="flex items-center gap-3">
                    <span className="flex-1 truncate text-fg">
                      {m.displayName} <span className="text-fg-subtle">{m.email}</span>
                    </span>
                    <Badge>{ROLE_NAMES[m.role]}</Badge>
                    {m.role !== 'OWNER' && (t.canManage || self) ? (
                      <Button size="sm" variant="ghost" onClick={() => setRemoving({ userId: m.userId, name: m.displayName, self })}>{self ? 'Leave' : 'Remove'}</Button>
                    ) : null}
                  </li>
                );
              })}
              {t.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-3 text-fg-muted">
                  <span className="flex-1 truncate">{i.email} — invited</span>
                  <Badge>{ROLE_NAMES[i.role]}</Badge>
                  {t.canManage ? <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Withdraw</Button> : null}
                </li>
              ))}
            </ul>

            {t.canManage ? (
              canInvitePlan ? (
                <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
                  <Field label="Invite by email" htmlFor="team-email"><Input id="team-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                  <Field label="Role" htmlFor="team-role">
                    <Select id="team-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                      {TEAM_ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
                    </Select>
                  </Field>
                  <Button variant="primary" disabled={invite.isPending || !email || seatsFull} onClick={() => invite.mutate()}>Send invite</Button>
                </div>
              ) : (
                <p className="text-xs text-fg-muted">
                  Inviting people is included in {lowestPlanWithFeature('team.workspaces')?.name ?? 'Business'}. <Link to="/subscription" className="text-primary hover:underline">View plans</Link>
                </p>
              )
            ) : null}
            <p className="text-2xs text-fg-subtle">Admins can invite and remove people. Developer and Viewer are labels for now; per-bot permissions arrive with cloud sync.</p>
          </CardBody>
        </Card>
      ) : info.error ? (
        <p className="text-sm text-danger">{info.error.message}</p>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing?.self ? 'Leave this workspace?' : `Remove ${removing?.name ?? ''}?`}
        description={removing?.self ? 'You go back to your own workspace and plan.' : 'They lose access to this workspace’s plan within a few minutes.'}
        confirmLabel={removing?.self ? 'Leave' : 'Remove'}
        onConfirm={() => removing && remove.mutate(removing.userId)}
      />
    </Page>
  );
}
