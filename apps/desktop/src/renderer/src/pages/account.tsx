import { DEFAULT_PLANS, loginSchema, registerSchema } from '@delyforge/shared';
import { CircleCheck, CloudOff, LogOut, Mail, RefreshCw, UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Separator, Skeleton } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { useAccount, useAccountAction } from '@/lib/account';
import { call } from '@/lib/bridge';
import { timeAgo } from '@/lib/format';

function SignInForm() {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const login = useAccountAction((i: { email: string; password: string }) => call((b) => b.account.login(i)), 'Signed in');
  const register = useAccountAction((i: { email: string; password: string; displayName: string }) => call((b) => b.account.register(i)), 'Account created — check your email to confirm it');
  const forgot = useAccountAction((e: string) => call((b) => b.account.forgotPassword(e)));
  const busy = login.isPending || register.isPending || forgot.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'forgot') {
      forgot.mutate(email, { onSuccess: () => setSent(true) });
      return;
    }
    const schema = mode === 'login' ? loginSchema : registerSchema;
    const parsed = schema.safeParse(mode === 'login' ? { email, password } : { email, password, displayName });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your details');
      return;
    }
    if (mode === 'login') login.mutate({ email, password });
    else register.mutate({ email, password, displayName });
  };

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader title={mode === 'register' ? 'Create your DelyForge account' : mode === 'forgot' ? 'Reset your password' : 'Sign in to DelyForge'} description="Your account holds your subscription and unlocks AI, the marketplace and team features. Bot tokens never leave this computer." />
      <CardBody>
        {mode !== 'forgot' ? (
          <Segmented
            ariaLabel="Sign in or create account"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { value: 'login', label: 'Sign in' },
              { value: 'register', label: 'Create account' },
            ]}
            className="mb-4"
          />
        ) : null}
        {sent ? (
          <p className="text-sm text-fg-muted">If that email has an account, a reset link is on its way. Open it, choose a new password, then sign in here.</p>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            {mode === 'register' ? (
              <Field label="Your name" htmlFor="acc-name">
                <Input id="acc-name" autoComplete="name" value={displayName} maxLength={50} onChange={(e) => setDisplayName(e.target.value)} />
              </Field>
            ) : null}
            <Field label="Email" htmlFor="acc-email">
              <Input id="acc-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {mode !== 'forgot' ? (
              <Field label="Password" htmlFor="acc-password" hint={mode === 'register' ? 'At least 10 characters. A short sentence works well.' : undefined}>
                <Input id="acc-password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            ) : null}
            {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
            </Button>
          </form>
        )}
        <div className="mt-4 text-center text-xs">
          {mode === 'forgot' ? (
            <button type="button" className="text-primary hover:underline" onClick={() => (setMode('login'), setSent(false))}>
              Back to sign in
            </button>
          ) : mode === 'login' ? (
            <button type="button" className="text-fg-subtle hover:text-fg" onClick={() => setMode('forgot')}>
              Forgot your password?
            </button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

export function AccountPage() {
  const account = useAccount();
  const logout = useAccountAction(() => call((b) => b.account.logout()), 'Signed out');
  const refresh = useAccountAction(() => call((b) => b.account.refresh()), 'Plan refreshed');
  const resend = useAccountAction(() => call((b) => b.account.resendVerification()), 'Verification email sent');
  const update = useAccountAction((name: string) => call((b) => b.account.updateProfile(name)), 'Profile saved');
  const [name, setName] = useState<string | null>(null);
  const s = account.data;

  return (
    <Page route="/account" ready={!account.isLoading} width="narrow">
      <PageHeader title="Account" description="Your DelyForge account, profile and plan." />
      {account.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !s?.signedIn ? (
        <SignInForm />
      ) : (
        <div className="space-y-4">
          {s.offline ? (
            <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg-muted">
              <CloudOff className="mt-0.5 size-4 shrink-0 text-warning" />
              Can’t reach DelyForge’s servers. Your plan keeps working offline for up to 7 days after the last check.
            </div>
          ) : null}
          {s.profile && !s.profile.emailVerified ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-info/25 bg-info-soft px-4 py-3 text-sm text-fg-muted">
              <span className="flex items-center gap-2">
                <Mail className="size-4 text-info" /> Please confirm your email address — we sent you a link.
              </span>
              <Button size="sm" onClick={() => resend.mutate(undefined)} disabled={resend.isPending}>
                Send again
              </Button>
            </div>
          ) : null}
          <Card>
            <CardHeader title="Profile" />
            <CardBody className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <UserRound className="size-6" />
                </span>
                <div>
                  <div className="text-sm font-medium text-fg">{s.profile?.displayName}</div>
                  <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
                    {s.profile?.email}
                    {s.profile?.emailVerified ? <CircleCheck className="size-3.5 text-success" aria-label="Verified" /> : null}
                  </div>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <Field label="Display name" htmlFor="acc-display">
                  <Input id="acc-display" className="w-72" maxLength={50} value={name ?? s.profile?.displayName ?? ''} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Button disabled={!name || name === s.profile?.displayName || update.isPending} onClick={() => name && update.mutate(name)}>
                  Save
                </Button>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Plan"
              action={
                <Button size="sm" variant="ghost" onClick={() => refresh.mutate(undefined)} disabled={refresh.isPending}>
                  <RefreshCw /> Check again
                </Button>
              }
            />
            <CardBody className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-fg">{DEFAULT_PLANS[s.plan?.effectivePlanId ?? 'free'].name}</span>
                {s.plan?.reason === 'grace_period' ? <Badge tone="warning">Payment problem — grace period</Badge> : null}
                {s.plan?.reason === 'subscription_inactive' ? <Badge tone="danger">Subscription inactive</Badge> : null}
              </div>
              <p className="text-xs text-fg-subtle">{s.verifiedAt ? `Verified with the server ${timeAgo(s.verifiedAt)}.` : 'Not verified yet.'}</p>
              <Button size="sm" asChild>
                <Link to="/subscription">Plans & billing</Link>
              </Button>
            </CardBody>
          </Card>
          <div className="flex gap-2">
            <Button size="sm" asChild>
              <Link to="/team">Team</Link>
            </Button>
            {s.profile?.role === 'ADMIN' || s.profile?.role === 'SUPPORT' ? (
              <Button size="sm" asChild>
                <Link to="/admin">Admin dashboard</Link>
              </Button>
            ) : null}
          </div>
          <Separator />
          <Button variant="ghost" onClick={() => logout.mutate(undefined)} disabled={logout.isPending}>
            <LogOut /> Sign out
          </Button>
        </div>
      )}
    </Page>
  );
}
