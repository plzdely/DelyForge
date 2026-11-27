import { type FeatureKey, PERSONAL_EDITION } from '@delyforge/shared';
import {
  Activity,
  AudioLines,
  Cake,
  CalendarClock,
  Gauge,
  Pin,
  Rss,
  ShieldAlert,
  Star,
  UserPlus,
  BadgeCheck,
  Blocks,
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
  ShoppingBag,
  Mail,
  ClipboardList,
  Coins,
  Dices,
  Smile,
  Sparkles,
  SquareSlash,
  Store,
  Ticket,
  TrendingUp,
  UserRound,
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
        available: true,
        phase: 3,
        summary: 'Alerts when a bot disconnects, crashes or cannot log in.',
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
        summary: 'Create a bot project, then connect it to Discord with the guided setup.',
      },
      {
        id: 'templates',
        label: 'Bot Templates',
        path: '/templates',
        icon: LayoutTemplate,
        available: true,
        phase: 5,
        summary: 'Start from a ready-made bot: gaming, support, streamer, business and more.',
        planned: ['10 built-in templates', 'Preview before installing', 'Import, export & share'],
      },
      {
        id: 'monitoring',
        label: 'Bot Monitoring',
        path: '/monitoring',
        icon: Activity,
        available: true,
        phase: 3,
        summary: 'Live status, latency, CPU, memory and uptime for every bot.',
      },
    ],
  },
  {
    id: 'builders',
    label: 'Build',
    items: [
      { id: 'modules', label: 'Modules', path: '/modules', icon: Blocks, available: true, phase: 4, summary: 'Ready-made features for your server: welcome, moderation, tickets, leveling and more.' },
      {
        id: 'commands',
        label: 'Command Builder',
        path: '/builders/commands',
        icon: SquareSlash,
        available: true,
        phase: 5,
        summary: 'Create slash and context-menu commands visually — no code.',
        planned: ['Arguments, permissions & cooldowns', 'Buttons, select menus & modals', 'Live preview & testing'],
      },
      {
        id: 'embeds',
        label: 'Embed Builder',
        path: '/builders/embeds',
        icon: PanelsTopLeft,
        available: true,
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
        available: true,
        phase: 5,
        summary: 'Drag-and-drop workflows: when something happens in Discord, do anything.',
        planned: ['Triggers, conditions, actions & delays', 'Test mode & execution history', 'Workflow templates & versioning'],
      },
      {
        id: 'ai',
        label: 'AI Bot Builder',
        path: '/builders/ai',
        icon: Sparkles,
        available: true,
        phase: 6,
        feature: 'ai.builder',
        summary: 'Describe your bot in plain English and review the generated setup before applying it.',
        planned: ['Prompt → full bot configuration', 'Preview & approve every change', 'AI troubleshooting'],
      },
    ],
  },
  {
    id: 'ecosystem',
    label: 'Ecosystem',
    items: [
      { id: 'marketplace', label: 'Marketplace', path: '/marketplace', icon: Store, available: true, phase: 8, feature: 'marketplace.access', summary: 'Templates, workflow packs, plugins and themes from the community.' },
      { id: 'plugins', label: 'Plugins', path: '/plugins', icon: Puzzle, available: false, phase: 8, summary: 'Install sandboxed, permission-controlled extensions.' },
      { id: 'integrations', label: 'Integrations', path: '/integrations', icon: Plug, available: false, phase: 8, summary: 'Connect DelyForge to the tools you already use.' },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'analytics', label: 'Analytics', path: '/analytics', icon: ChartColumn, available: true, phase: 9, summary: 'Uptime, command usage, errors and growth over time.' },
      { id: 'team', label: 'Team Workspace', path: '/team', icon: Users, available: true, phase: 9, feature: 'team.workspaces', summary: 'Invite your team and control who can manage each bot.' },
      {
        id: 'account',
        label: 'Account',
        path: '/account',
        icon: UserRound,
        available: true,
        phase: 7,
        summary: 'Sign in, profile and plan.',
      },
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

/** Every module, shown as cards on the Modules page (the sidebar has a single “Modules” entry). */
export const MODULE_NAV_ITEMS: NavItem[] = [
  { id: 'moderation', label: 'Moderation', path: '/modules/moderation', icon: Shield, available: true, phase: 4, summary: 'Staff commands, warnings with automatic thresholds, and auto-moderation.' },
  { id: 'welcome', label: 'Welcome', path: '/modules/welcome', icon: DoorOpen, available: true, phase: 4, summary: 'Welcome & goodbye messages, welcome DMs and automatic roles.' },
  { id: 'tickets', label: 'Tickets', path: '/modules/tickets', icon: Ticket, available: true, phase: 4, feature: 'modules.standard', summary: 'A ticket button that opens private support channels, with transcripts when closed.' },
  { id: 'leveling', label: 'Leveling', path: '/modules/leveling', icon: TrendingUp, available: true, phase: 4, feature: 'modules.standard', summary: 'XP, levels, leaderboards and role rewards.' },
  { id: 'logging', label: 'Logging', path: '/modules/logging', icon: ScrollText, available: true, phase: 4, feature: 'modules.standard', summary: 'Who did what: messages, joins and leaves, and every staff change with who made it.' },
  { id: 'verification', label: 'Verification', path: '/modules/verification', icon: BadgeCheck, available: true, phase: 4, feature: 'modules.standard', summary: 'A verify button that gives new members access, with an optional minimum account age.' },
  { id: 'utility', label: 'Utility', path: '/modules/utility', icon: Wrench, available: true, phase: 4, summary: 'Server & user info, avatars and native Discord polls.' },
  { id: 'reaction-roles', label: 'Reaction Roles', path: '/modules/reactionRoles', icon: Smile, available: true, phase: 4, feature: 'modules.standard', summary: 'Button and select-menu role panels.' },
  { id: 'suggestions', label: 'Suggestions', path: '/modules/suggestions', icon: Lightbulb, available: true, phase: 4, feature: 'modules.standard', summary: 'Submissions, voting and staff review.' },
  { id: 'giveaways', label: 'Giveaways', path: '/modules/giveaways', icon: Gift, available: true, phase: 4, feature: 'modules.standard', summary: 'Timed giveaways with requirements and rerolls.' },
  { id: 'invites', label: 'Invite Tracker', path: '/modules/invites', icon: UserPlus, available: true, phase: 4, feature: 'modules.standard', summary: 'Who invited each new member, invite counts and a leaderboard.' },
  { id: 'starboard', label: 'Starboard', path: '/modules/starboard', icon: Star, available: true, phase: 4, feature: 'modules.standard', summary: 'Showcase messages that get enough ⭐ reactions.' },
  { id: 'temp-voice', label: 'Temporary Voice', path: '/modules/tempVoice', icon: AudioLines, available: true, phase: 4, feature: 'modules.standard', summary: 'Join to create your own voice channel; deleted when empty.' },
  { id: 'anti-raid', label: 'Raid Protection', path: '/modules/antiRaid', icon: ShieldAlert, available: true, phase: 4, feature: 'modules.standard', summary: 'Spot join floods and keep brand-new accounts out.' },
  { id: 'sticky', label: 'Sticky Messages', path: '/modules/sticky', icon: Pin, available: true, phase: 4, feature: 'modules.standard', summary: 'Keep a message at the bottom of a busy channel.' },
  { id: 'server-stats', label: 'Server Stats', path: '/modules/serverStats', icon: Gauge, available: true, phase: 4, feature: 'modules.standard', summary: 'Channel names showing live member, bot and boost counts.' },
  { id: 'birthdays', label: 'Birthdays', path: '/modules/birthdays', icon: Cake, available: true, phase: 4, feature: 'modules.standard', summary: 'Celebrate members on their birthday with a message and a role.' },
  { id: 'feeds', label: 'Social Alerts', path: '/modules/feeds', icon: Rss, available: true, phase: 4, feature: 'modules.standard', summary: 'Announce new YouTube videos and posts from news or RSS feeds.' },
  { id: 'scheduled', label: 'Scheduled Messages', path: '/modules/scheduled', icon: CalendarClock, available: true, phase: 4, feature: 'modules.standard', summary: 'Post announcements automatically on chosen days and times.' },
  { id: 'modmail', label: 'Modmail', path: '/modules/modmail', icon: Mail, available: true, phase: 4, feature: 'modules.standard', summary: 'Members DM the bot to reach staff privately; staff reply from a thread.' },
  { id: 'applications', label: 'Applications', path: '/modules/applications', icon: ClipboardList, available: true, phase: 4, feature: 'modules.standard', summary: 'Application forms with a review channel, Accept/Deny, roles and DMs.' },
  { id: 'economy', label: 'Economy', path: '/modules/economy', icon: Coins, available: true, phase: 4, feature: 'modules.standard', summary: 'Server coins: daily, work, pay, rob, gambling, leaderboard and a role shop.' },
  { id: 'games', label: 'Counting & Games', path: '/modules/games', icon: Dices, available: true, phase: 4, feature: 'modules.standard', summary: 'A counting channel with records, trivia with prizes, rock-paper-scissors and 8-ball.' },
  { id: 'shop', label: 'Shop', path: '/modules/shop', icon: ShoppingBag, available: true, phase: 4, feature: 'modules.standard', summary: 'A price list the bot keeps updated, automatic sales, an Order button, discount codes and vouches.' },
];

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_SECTIONS.flatMap((s) => s.items), ...MODULE_NAV_ITEMS];

/** The nav item a path belongs to — e.g. `/bots/<id>` belongs to "My Bots", `/bots/new` to "Create Bot". */
export function navItemForPath(pathname: string): NavItem | undefined {
  const exact = ALL_NAV_ITEMS.find((i) => i.path === pathname);
  if (exact) return exact;
  return ALL_NAV_ITEMS.filter((i) => i.path !== '/' && pathname.startsWith(`${i.path}/`)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
}

/** Screens that need a paid DelyForge server; hidden in the personal edition. */
const SERVER_ONLY = new Set(['ai', 'marketplace', 'team', 'account', 'subscription']);

export function visibleSections(showRoadmap: boolean): NavSection[] {
  return NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => (i.available || showRoadmap) && !(PERSONAL_EDITION && SERVER_ONLY.has(i.id))),
  })).filter(
    (s) => s.items.length > 0,
  );
}
