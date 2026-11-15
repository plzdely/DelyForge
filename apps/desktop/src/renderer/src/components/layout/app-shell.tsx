import { BRAND } from '@delyforge/shared';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Wordmark } from '@/components/brand/logo';
import { DiscordConnect } from '@/components/account/discord-connect';
import { Button } from '@/components/ui/button';
import { useAccount, useAccountAction } from '@/lib/account';
import { call } from '@/lib/bridge';
import { useSettings } from '@/lib/queries';
import { SignInForm } from '@/pages/account';
import { useBotEventStream } from '@/lib/runtime';
import { navItemForPath } from '@/navigation';
import { Sidebar } from './sidebar';

/** Keeps <html data-theme> and reduce-motion in sync with settings (and with the OS when theme = system). */
function useThemeSync() {
  const { data: settings } = useSettings();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const theme = settings?.theme ?? 'dark';
    const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
    document.documentElement.dataset['theme'] = resolved;
    document.documentElement.dataset['reduceMotion'] = String(settings?.reduceMotion ?? false);
  }, [settings?.theme, settings?.reduceMotion, systemDark]);
}

function TitleBar() {
  const { pathname } = useLocation();
  const current = navItemForPath(pathname);
  return (
    <header className="drag-region flex h-10 shrink-0 items-center border-b border-border bg-bg-subtle pr-[140px]">
      <div className="flex w-60 items-center gap-2 px-4">
        <Wordmark />
        <span className="text-2xs text-fg-subtle">{BRAND.byline}</span>
      </div>
      {current ? (
        <div className="flex items-center gap-1.5 pl-5 text-xs text-fg-subtle">
          <span>{current.label}</span>
        </div>
      ) : null}
    </header>
  );
}

/** Customer builds: before anything else, sign in and link Discord (the main process enforces the same rule). */
function AccessGate({ needs }: { needs: 'sign-in' | 'discord' | null }) {
  const logout = useAccountAction(() => call((b) => b.account.logout()), 'Signed out');
  return (
    <div className="flex h-full flex-col bg-bg">
      <TitleBar />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-md space-y-4 px-6 py-12">
          <div>
            <h1 className="text-xl font-semibold text-fg">Welcome to DelyForge</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {needs === 'discord' ? 'One last step: connect your Discord account.' : 'Sign in or create a free account to get started.'}
            </p>
          </div>
          {needs === 'discord' ? (
            <>
              <DiscordConnect required />
              <Button variant="ghost" onClick={() => logout.mutate(undefined)}>Sign out</Button>
            </>
          ) : (
            <SignInForm />
          )}
        </div>
      </main>
    </div>
  );
}

export function AppShell() {
  useThemeSync();
  useBotEventStream();
  const { pathname } = useLocation();
  const access = useAccount().data?.access;
  if (access && !access.allowed) return <AccessGate needs={access.needs} />;
  return (
    <div className="flex h-full flex-col bg-bg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          {/* key → re-run the enter animation on navigation */}
          <div key={pathname} className="animate-enter">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
