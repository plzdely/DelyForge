import './styles/globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createHashRouter } from 'react-router';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { isBridgeAvailable } from '@/lib/bridge';
import { DashboardPage } from '@/pages/dashboard';
import { RoadmapPage } from '@/pages/roadmap';
import { SettingsPage } from '@/pages/settings';
import { SubscriptionPage } from '@/pages/subscription';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// Hash routing works with the private app:// protocol and needs no server-side fallback.
const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'subscription', element: <SubscriptionPage /> },
      { path: '*', element: <RoadmapPage /> },
    ],
  },
]);

function BridgeMissing() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-lg font-semibold text-fg">DelyForge Desktop runtime not found</h1>
        <p className="mt-1 text-sm text-fg-muted">
          This interface must be opened inside the DelyForge desktop app. Run <code>pnpm dev:desktop</code>.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isBridgeAvailable() ? (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
          <Toaster
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast: '!bg-surface-raised !border-border-strong !text-fg !shadow-pop !rounded-lg !text-sm',
                description: '!text-fg-muted',
              },
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    ) : (
      <BridgeMissing />
    )}
  </StrictMode>,
);
