import { BRAND } from '@delyforge/shared';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Wordmark } from '@/components/brand/logo';
import { useSettings } from '@/lib/queries';
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

export function AppShell() {
  useThemeSync();
  useBotEventStream();
  const { pathname } = useLocation();
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
