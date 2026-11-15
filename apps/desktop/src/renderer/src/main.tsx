import './styles/globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createHashRouter } from 'react-router';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { isBridgeAvailable } from '@/lib/bridge';
import { AutomationsTab, CommandsTab, EmbedsTab } from '@/pages/bots/builders';
import { AccountPage } from '@/pages/account';
import { BotConsole } from '@/pages/bots/console';
import { AiBuilderPage } from '@/pages/ai-builder';
import { MarketplacePage } from '@/pages/marketplace';
import { AnalyticsPage } from '@/pages/analytics';
import { BuilderDirectoryPage, TemplatesPage } from '@/pages/templates';
import { ConnectWizard } from '@/pages/bots/connect';
import { BotLayout } from '@/pages/bots/layout';
import { ModuleSettings } from '@/pages/bots/module-settings';
import { BotModules } from '@/pages/bots/modules';
import { ModuleDirectoryPage } from '@/pages/module-directory';
import { BotOverview } from '@/pages/bots/overview';
import { BotSettings } from '@/pages/bots/settings';
import { MonitoringPage } from '@/pages/monitoring';
import { NotificationsPage } from '@/pages/notifications';
import { BotsPage } from '@/pages/bots/list';
import { CreateBotPage } from '@/pages/bots/new';
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
      { path: 'account', element: <AccountPage /> },
      { path: 'bots', element: <BotsPage /> },
      { path: 'bots/new', element: <CreateBotPage /> },
      {
        path: 'bots/:id',
        element: <BotLayout />,
        children: [
          { index: true, element: <BotOverview /> },
          { path: 'modules', element: <BotModules /> },
          { path: 'modules/:moduleId', element: <ModuleSettings /> },
          { path: 'commands', element: <CommandsTab /> },
          { path: 'embeds', element: <EmbedsTab /> },
          { path: 'automations', element: <AutomationsTab /> },
          { path: 'console', element: <BotConsole /> },
          { path: 'settings', element: <BotSettings /> },
          { path: 'connect', element: <ConnectWizard /> },
        ],
      },
      { path: 'monitoring', element: <MonitoringPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'modules/:moduleId', element: <ModuleDirectoryPage /> },
      { path: 'builders/ai', element: <AiBuilderPage /> },
      { path: 'builders/:section', element: <BuilderDirectoryPage /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: 'marketplace', element: <MarketplacePage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
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
