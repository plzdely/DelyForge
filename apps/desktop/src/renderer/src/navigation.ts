import type { FeatureKey } from '@delyforge/shared';
import {
  Activity,
  BadgeCheck,
  Bell,
  Bot,
  ChartColumn,
  CirclePlus,
  CreditCard,
  DoorOpen,
  Gift,
  LayoutDashboard,
  LayoutTemplate,
  Lightbulb,
  type LucideIcon,
  PanelsTopLeft,
  Plug,
  Puzzle,
  ScrollText,
  Settings,
  Shield,
  Smile,
  Sparkles,
  SquareSlash,
  Store,
  Ticket,
  TrendingUp,
  Users,
  Workflow,
  Wrench,
} from 'lucide-react';

/**
 * Single source of truth for the sidebar.
 *
 * `available: true`  → the page is built and works. Shown to everyone.
 * `available: false` → planned. Hidden unless the user enables "Roadmap preview" in Settings, in which case it opens an
 *                      honest roadmap page (never a fake, non-working screen).
 * `feature`          → premium feature key; users without it see a lock and the plan that unlocks it.
 */
export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  available: boolean;
  phase: number;
  feature?: FeatureKey;
  summary: string;
  planned?: string[];
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        path: '/',
        icon: LayoutDashboard,
        available: true,
        phase: 1,
        summary: 'Your bots, activity and account at a glance.',
      },
      {
        id: 'notifications',
        label: 'Notifications',
        path: '/notifications',
        icon: Bell,
        available: false,
        phase: 2,
        summary: 'Alerts when a bot disconnects, crashes, or a workflow fails.',
        planned: ['Bot crash & disconnect alerts', 'Workflow failure alerts', 'Billing & security notices', 'Per-type preferences'],
      },
    ],
  },
  {
    id: 'bots',
    label: 'Bot management',
    items: [
      {
        id: 'bots',
        label: 'My Bots',
        path: '/bots',
        icon: Bot,
        available: true,
        phase: 2,
        summary: 'Every bot project in one place — search, group, favorite and control them.',
      },
      {
        id: 'create-bot',
        label: 'Create Bot',
        path: '/bots/new',
        icon: CirclePlus,
        available: true,
        phase: 2,
        summary: 'Create a bot project. The guided Discord connection wizard is added in Phase 3.',
      },
      {
        id: 'templates',
        label: 'Bot Templates',
        path: '/templates',
        icon: LayoutTemplate,
        available: false,
        phase: 5,
        summary: 'Start from a ready-made bot: gaming, support, streamer, business and more.',
        planned: ['10 built-in templates', 'Preview before installing', 'Import, export & share'],
      },
      {
        id: 'monitoring',
        label: 'Bot Monitoring',
        path: '/monitoring',
        icon: Activity,
        available: false,
        phase: 3,
        summary: 'Live console, latency, CPU, memory and uptime for every bot.',
        planned: ['Real-time logs with search & filters', 'Latency, CPU & memory graphs', 'Crash detection & auto-restart'],
      },
    ],
  },
  {
    id: 'builders',
    label: 'Builders',
    items: [
      {
        id: 'commands',
        label: 'Command Builder',
        path: '/builders/commands',
        icon: SquareSlash,
        available: false,
        phase: 5,
        summary: 'Create slash and context-menu commands visually — no code.',
        planned: ['Arguments, permissions & cooldowns', 'Buttons, select menus & modals', 'Live preview & testing'],
      },
      {
        id: 'embeds',
        label: 'Embed Builder',
        path: '/builders/embeds',
        icon: PanelsTopLeft,
        available: false,
        phase: 5,
        feature: 'builder.embeds',
        summary: 'Design Discord embeds with a pixel-accurate live preview.',
        planned: ['Every embed field', 'Discord limit validation', 'Reusable embed templates'],
      },
      {
        id: 'automation',
        label: 'Automation Studio',
        path: '/builders/automation',
        icon: Workflow,
        available: false,
        phase: 5,
        summary: 'Drag-and-drop workflows: when something happens in Discord, do anything.',
        planned: ['Triggers, conditions, actions & delays', 'Test mode & execution history', 'Workflow templates & versioning'],
      },
      {
        id: 'ai',
        label: 'AI Bot Builder',
        path: '/builders/ai',
        icon: Sparkles,
        available: false,
        phase: 6,
        feature: 'ai.builder',
        summary: 'Describe your bot in plain English and review the generated setup before applying it.',
        planned: ['Prompt → full bot configuration', 'Preview & approve every change', 'AI troubleshooting'],
      },
    ],
  },
  {
    id: 'modules',
    label: 'Modules',
    items: [
      { id: 'moderation', label: 'Moderation', path: '/modules/moderation', icon: Shield, available: false, phase: 4, summary: 'Kick, ban, timeout, warnings, auto-moderation and appeals.' },
      { id: 'welcome', label: 'Welcome', path: '/modules/welcome', icon: DoorOpen, available: false, phase: 4, summary: 'Welcome & goodbye messages, images and auto-roles.' },
      { id: 'tickets', label: 'Tickets', path: '/modules/tickets', icon: Ticket, available: false, phase: 4, summary: 'Ticket panels, categories, transcripts and ratings.' },
      { id: 'leveling', label: 'Leveling', path: '/modules/leveling', icon: TrendingUp, available: false, phase: 4, summary: 'XP, levels, leaderboards and role rewards.' },
      { id: 'logging', label: 'Logging', path: '/modules/logging', icon: ScrollText, available: false, phase: 4, summary: 'Message, member, role, channel and moderation logs.' },
      { id: 'verification', label: 'Verification', path: '/modules/verification', icon: BadgeCheck, available: false, phase: 4, summary: 'Verification buttons, steps and staff review.' },
      { id: 'utility', label: 'Utility', path: '/modules/utility', icon: Wrench, available: false, phase: 4, summary: 'Server & user info, polls, reminders, announcements.' },
      { id: 'reaction-roles', label: 'Reaction Roles', path: '/modules/reaction-roles', icon: Smile, available: false, phase: 4, summary: 'Button and select-menu role panels.' },
      { id: 'suggestions', label: 'Suggestions', path: '/modules/suggestions', icon: Lightbulb, available: false, phase: 4, summary: 'Submissions, voting and staff review.' },
      { id: 'giveaways', label: 'Giveaways', path: '/modules/giveaways', icon: Gift, available: false, phase: 4, summary: 'Timed giveaways with requirements and rerolls.' },
    ],
  },
  {
    id: 'ecosystem',
    label: 'Ecosystem',
    items: [
      { id: 'marketplace', label: 'Marketplace', path: '/marketplace', icon: Store, available: false, phase: 8, feature: 'marketplace.access', summary: 'Templates, workflow packs, plugins and themes from the community.' },
      { id: 'plugins', label: 'Plugins', path: '/plugins', icon: Puzzle, available: false, phase: 8, summary: 'Install sandboxed, permission-controlled extensions.' },
      { id: 'integrations', label: 'Integrations', path: '/integrations', icon: Plug, available: false, phase: 8, summary: 'Connect DelyForge to the tools you already use.' },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'analytics', label: 'Analytics', path: '/analytics', icon: ChartColumn, available: false, phase: 9, summary: 'Uptime, command usage, errors and growth over time.' },
      { id: 'team', label: 'Team Workspace', path: '/team', icon: Users, available: false, phase: 9, feature: 'team.workspaces', summary: 'Invite your team and control who can manage each bot.' },
      {
        id: 'subscription',
        label: 'Subscription',
        path: '/subscription',
        icon: CreditCard,
        available: true,
        phase: 1,
        summary: 'Plans, limits and billing.',
      },
      {
        id: 'settings',
        label: 'Settings',
        path: '/settings',
        icon: Settings,
        available: true,
        phase: 1,
        summary: 'Appearance, accessibility and app information.',
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** The nav item a path belongs to — e.g. `/bots/<id>` belongs to "My Bots", `/bots/new` to "Create Bot". */
export function navItemForPath(pathname: string): NavItem | undefined {
  const exact = ALL_NAV_ITEMS.find((i) => i.path === pathname);
  if (exact) return exact;
  return ALL_NAV_ITEMS.filter((i) => i.path !== '/' && pathname.startsWith(`${i.path}/`)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
}

export function visibleSections(showRoadmap: boolean): NavSection[] {
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => i.available || showRoadmap) })).filter(
    (s) => s.items.length > 0,
  );
}
