import type { CustomCommand } from './builders.js';
import { DEFAULT_MODULE_CONFIGS as D, type GuildModules, type ModuleConfigs } from './modules.js';
import type { FeatureKey } from './plans.js';

/**
 * Built-in bot templates. A template switches modules on with sensible settings and adds a few custom commands.
 * Templates never contain channel or role IDs (those differ per server) — the user picks channels afterwards.
 */
export interface BotTemplate {
  id: string;
  name: string;
  category: 'Community' | 'Gaming' | 'Business' | 'Creators' | 'Moderation' | 'Fun';
  summary: string;
  /** Plan feature needed to apply it. */
  feature: Extract<FeatureKey, 'templates.limited' | 'templates.standard' | 'templates.premium'>;
  modules: GuildModules;
  commands: CustomCommand[];
}

const on = <K extends keyof ModuleConfigs>(k: K, patch: Partial<ModuleConfigs[K]> = {}): ModuleConfigs[K] => ({ ...D[k], ...patch, enabled: true });

const textCommand = (id: string, name: string, description: string, text: string): CustomCommand => ({
  id,
  enabled: true,
  type: 'slash',
  name,
  description,
  options: [],
  access: 'everyone',
  cooldownSeconds: 5,
  response: { text, embedId: '', ephemeral: false, buttons: [] },
});

const automod = { ...D.moderation.automod, enabled: true };

export const TEMPLATES: readonly BotTemplate[] = [
  {
    id: 'starter',
    name: 'Starter community',
    category: 'Community',
    summary: 'Welcome messages, basic moderation commands and handy utilities — a great first bot.',
    feature: 'templates.limited',
    modules: { welcome: on('welcome'), moderation: on('moderation'), utility: on('utility') },
    commands: [textCommand('t1', 'rules', 'Show the server rules', '📜 **Server rules**\n1. Be kind.\n2. No spam.\n3. Keep it on topic.')],
  },
  {
    id: 'moderation',
    name: 'Moderation bot',
    category: 'Moderation',
    summary: 'Staff commands, warning thresholds, auto-moderation and full logging.',
    feature: 'templates.limited',
    modules: { moderation: on('moderation', { automod }), logging: on('logging') },
    commands: [],
  },
  {
    id: 'giveaway',
    name: 'Giveaway bot',
    category: 'Fun',
    summary: 'Run fair, timed giveaways with a join button.',
    feature: 'templates.limited',
    modules: { giveaways: on('giveaways'), utility: on('utility') },
    commands: [],
  },
  {
    id: 'gaming',
    name: 'Gaming community',
    category: 'Gaming',
    summary: 'Welcome, leveling with role rewards, game role panels, giveaways and moderation.',
    feature: 'templates.standard',
    modules: { welcome: on('welcome'), leveling: on('leveling'), reactionRoles: on('reactionRoles'), giveaways: on('giveaways'), moderation: on('moderation', { automod }) },
    commands: [textCommand('t1', 'lfg', 'Looking for a group', '🎮 {user} is looking for a group! Reply here to join.')],
  },
  {
    id: 'support',
    name: 'Support server',
    category: 'Business',
    summary: 'Ticket panel with transcripts, logging and suggestions for product feedback.',
    feature: 'templates.standard',
    modules: { tickets: on('tickets'), logging: on('logging'), suggestions: on('suggestions'), moderation: on('moderation') },
    commands: [textCommand('t1', 'help', 'How to get help', 'Need help? Open a ticket with the button in the support channel and our team will reply soon.')],
  },
  {
    id: 'leveling',
    name: 'Leveling bot',
    category: 'Community',
    summary: 'XP for chatting, level-up messages, leaderboards and rank commands.',
    feature: 'templates.standard',
    modules: { leveling: on('leveling') },
    commands: [],
  },
  {
    id: 'streamer',
    name: 'Streamer community',
    category: 'Creators',
    summary: 'Welcome new followers, giveaways for subs, role panels and a schedule command.',
    feature: 'templates.standard',
    modules: { welcome: on('welcome'), giveaways: on('giveaways'), reactionRoles: on('reactionRoles'), moderation: on('moderation') },
    commands: [textCommand('t1', 'schedule', 'Stream schedule', '📅 **Stream schedule**\nMon / Wed / Fri — 7pm. See you there!')],
  },
  {
    id: 'business',
    name: 'Business community',
    category: 'Business',
    summary: 'Verification, tickets, suggestions and logging for professional communities.',
    feature: 'templates.premium',
    modules: { verification: on('verification'), tickets: on('tickets'), suggestions: on('suggestions'), logging: on('logging'), moderation: on('moderation') },
    commands: [],
  },
  {
    id: 'roleplay',
    name: 'Roleplay server',
    category: 'Fun',
    summary: 'Verification with account-age check, character role panels and leveling.',
    feature: 'templates.premium',
    modules: { verification: on('verification', { minAccountAgeDays: 7 }), reactionRoles: on('reactionRoles'), leveling: on('leveling'), welcome: on('welcome') },
    commands: [],
  },
  {
    id: 'all-in-one',
    name: 'Complete all-in-one bot',
    category: 'Community',
    summary: 'Every module switched on with recommended settings.',
    feature: 'templates.premium',
    modules: {
      welcome: on('welcome'),
      moderation: on('moderation', { automod }),
      logging: on('logging'),
      utility: on('utility'),
      leveling: on('leveling'),
      tickets: on('tickets'),
      verification: on('verification'),
      reactionRoles: on('reactionRoles'),
      suggestions: on('suggestions'),
      giveaways: on('giveaways'),
    },
    commands: [textCommand('t1', 'rules', 'Show the server rules', '📜 **Server rules**\n1. Be kind.\n2. No spam.\n3. Keep it on topic.')],
  },
];
