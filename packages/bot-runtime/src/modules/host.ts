import { type BotModules, type Builders, type LogLevel, type ModuleConfigs, resolveGuildModules } from '@delyforge/shared';
import { type ButtonInteraction, type ChatInputCommandInteraction, type Client, type CommandInteraction, Events, type Guild, MessageFlags, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { BotStore, planCommandSync } from '../store.js';
import { commandKey, customCommandJSON, dueScheduledWorkflows, matchingWorkflows, runCustomCommand, runWorkflow } from './builders.js';
import { commandHash, desiredCommands } from './commands.js';
import type { ModuleContext } from './context.js';
import * as logging from './logging.js';
import { MODERATION_COMMANDS, automodCheck, endTempBans, handleModerationCommand, onAuditCase } from './moderation.js';
import { UTILITY_COMMANDS, handleUtilityCommand } from './utility.js';
import { endDueGiveaways, handleGiveaway, handleSuggest, onGiveawayEnter, onSuggestionButton, onSuggestionDecision } from './community.js';
import { LEVELING_COMMANDS, handleLevelingCommand, onMemberLeaveXp, onMessageXp, voiceXp } from './leveling.js';
import { CID, syncPanels } from './panels.js';
import { kickUnverified, onRoleButton, onRoleMenu, onVerify, onVerifyAnswer } from './roles.js';
import { TICKET_COMMANDS, handleTicketCommand, onTicketClose, onTicketCloseConfirm, onTicketOpen } from './tickets.js';
import * as welcome from './welcome.js';
import * as antiRaid from './antiraid.js';
import { checkBirthdays, handleBirthdayCommand } from './birthdays.js';
import * as invites from './invites.js';
import * as starboard from './starboard.js';
import { updateStats } from './stats.js';
import * as sticky from './sticky.js';
import * as tempVoice from './tempvoice.js';
import { pollFeeds } from './feeds.js';
import { runScheduled } from './scheduled.js';
import { checkLostPermissions, notifyOwner, runModuleTest } from './trust.js';
import { diagnose, doctorInput } from './doctor.js';

/**
 * Connects Discord events to the enabled modules, per server, and keeps each server's slash commands in line with
 * its settings. Settings can be replaced at any time (`setModules`) without reconnecting.
 */
export class ModuleHost {
  private modules: BotModules;
  private builders: Builders;
  private store: BotStore | null = null;
  private syncing = new Set<string>();
  /** Servers whose settings changed during a sync — synced again as soon as it finishes. */
  private resync = new Set<string>();
  private giveawayTimer: ReturnType<typeof setInterval> | null = null;
  /** Every 30 s: scheduled messages and birthdays; every 10 minutes: social alerts and stats counters (Discord's rename limit). */
  private minuteTimer: ReturnType<typeof setInterval> | null = null;
  private minutes = 0;
  private readonly ctx: ModuleContext;

  constructor(
    private readonly client: Client,
    initial: { modules: BotModules; builders: Builders; dataDir: string },
    private readonly log: (level: LogLevel, message: string) => void,
    command: (name: string, ok: boolean, durationMs: number) => void,
    workflowRun: ModuleContext['workflowRun'],
    private readonly problem: (kind: 'permissions', message: string) => void = () => {},
  ) {
    this.modules = initial.modules;
    this.builders = initial.builders;
    this.dataDir = initial.dataDir;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const host = this;
    this.ctx = {
      client: client as Client<true>,
      get store() {
        return host.requireStore();
      },
      log,
      command,
      workflowRun,
      config: (guildId) => this.config(guildId),
    };
    this.wire();
  }

  config(guildId: string): ModuleConfigs {
    return resolveGuildModules(this.modules[guildId]);
  }

  private readonly dataDir: string;

  setBuilders(builders: Builders): void {
    this.builders = builders;
    this.log('info', `Builders updated: ${builders.commands.filter((c) => c.enabled).length} custom command(s), ${builders.workflows.filter((w) => w.enabled).length} workflow(s).`);
    void this.syncAllCommands();
  }

  setModules(modules: BotModules): void {
    this.modules = modules;
    this.log('info', 'Module settings updated.');
    void this.syncAllCommands();
  }

  /** Called once the client is ready: open the bot's data store and register commands. */
  async onReady(): Promise<void> {
    this.store = BotStore.open(this.dataDir, this.client.user!.id);
    const enabled = this.enabledSummary();
    if (enabled) this.log('info', `Active modules: ${enabled}.`);
    await this.syncAllCommands();
    // Giveaways end on time even across restarts, because end times are stored.
    this.giveawayTimer = setInterval(() => {
      if (this.store) void endDueGiveaways(this.ctx, this.client).catch((e: Error) => this.log('error', `Giveaways: ${e.message}`));
      if (this.store) void endTempBans(this.ctx, this.client).catch((e: Error) => this.log('error', `Temporary bans: ${e.message}`));
    }, 15_000);
    void this.everyMinute();
    this.minuteTimer = setInterval(() => void this.everyMinute(), 30_000);
  }

  private async everyMinute(): Promise<void> {
    const slowDue = this.minutes++ % 20 === 0; // every 10 minutes
    for (const guild of this.client.guilds.cache.values()) {
      if (!this.store) return;
      await runScheduled(this.ctx, guild).catch((e: Error) => this.log('error', `Scheduled messages: ${e.message}`));
      for (const w of dueScheduledWorkflows(this.builders.workflows.filter((x) => x.enabled && x.guildId === guild.id), guild.id, new Date())) {
        void runWorkflow(this.ctx, this.builders, w, { guild, user: null, member: null });
      }
      await checkBirthdays(this.ctx, guild).catch((e: Error) => this.log('error', `Birthdays: ${e.message}`));
      if (this.minutes % 2 === 0) await voiceXp(this.ctx, guild).catch((e: Error) => this.log('error', `Voice XP: ${e.message}`));
      if (slowDue) {
        await updateStats(this.ctx, guild).catch((e: Error) => this.log('error', `Server stats: ${e.message}`));
        await pollFeeds(this.ctx, guild).catch((e: Error) => this.log('error', `Social alerts: ${e.message}`));
        await kickUnverified(this.ctx, guild).catch((e: Error) => this.log('error', `Verification: ${e.message}`));
      }
    }
  }

  close(): void {
    if (this.giveawayTimer) clearInterval(this.giveawayTimer);
    if (this.minuteTimer) clearInterval(this.minuteTimer);
    this.store?.close();
    this.store = null;
  }

  private requireStore(): BotStore {
    if (!this.store) throw new Error('Bot data store is not open yet');
    return this.store;
  }

  private enabledSummary(): string {
    const parts: string[] = [];
    for (const guild of this.client.guilds.cache.values()) {
      const c = this.config(guild.id);
      const on = (Object.keys(c) as (keyof ModuleConfigs)[]).filter((k) => c[k].enabled);
      if (on.length) parts.push(`${guild.name}: ${on.join(', ')}`);
    }
    return parts.join(' · ');
  }

  // ─── Slash command sync ──────────────────────────────────────────────────────────────────────────────────────────

  private async syncAllCommands(): Promise<void> {
    if (!this.store || !this.client.isReady()) return;
    for (const guild of this.client.guilds.cache.values()) await this.syncGuildCommands(guild);
  }

  /** Brings a server in line with its settings: slash commands (only DelyForge's own) and posted panels. */
  private async syncGuildCommands(guild: Guild): Promise<void> {
    if (!this.store) return;
    if (this.syncing.has(guild.id)) {
      this.resync.add(guild.id);
      return;
    }
    this.syncing.add(guild.id);
    try {
      // Module commands are keyed by name; custom right-click commands by "type:name" (they may share a name).
      const desired = [
        ...desiredCommands(this.config(guild.id)).map((def) => ({ key: def.name, def: def as Parameters<typeof commandHash>[0] })),
        ...this.builders.commands.filter((c) => c.enabled).map((c) => ({ key: commandKey(c), def: customCommandJSON(c) })),
      ];
      const byName = new Map(desired.map((c) => [c.key, c.def]));
      const plan = planCommandSync(
        desired.map((c) => ({ name: c.key, hash: commandHash(c.def) })),
        this.store.managedCommands(guild.id),
      );
      for (const name of plan.create) {
        const def = byName.get(name)!;
        const created = await guild.commands.create(def);
        this.store.saveManagedCommand({ guildId: guild.id, name, commandId: created.id, hash: commandHash(def) });
      }
      for (const m of plan.update) {
        const def = byName.get(m.name)!;
        await guild.commands.edit(m.commandId, def).catch(async () => {
          const created = await guild.commands.create(def); // was deleted by hand — recreate
          m.commandId = created.id;
        });
        this.store.saveManagedCommand({ ...m, hash: commandHash(def) });
      }
      for (const m of plan.remove) {
        await guild.commands.delete(m.commandId).catch(() => null); // may already be gone
        this.store.removeManagedCommand(guild.id, m.name);
      }
      const changes = plan.create.length + plan.update.length + plan.remove.length;
      if (changes) {
        this.log('info', `Updated slash commands in “${guild.name}”: +${plan.create.length} ~${plan.update.length} −${plan.remove.length}.`);
      }
      const panelChanges = await syncPanels(this.ctx, guild);
      if (panelChanges) this.log('info', `Updated ${panelChanges} panel message(s) in “${guild.name}”.`);
      await invites.syncInvites(this.ctx, guild);
      await tempVoice.cleanupTempChannels(this.ctx, guild);
      checkLostPermissions(this.ctx, guild, (m) => this.problem('permissions', m), true);
    } catch (e) {
      this.log('warn', `Could not update “${guild.name}” to the new settings: ${(e as Error).message}`);
    } finally {
      this.syncing.delete(guild.id);
      if (this.resync.delete(guild.id)) void this.syncGuildCommands(guild);
    }
  }

  /** "Send a test" button: posts one module message in a server. */
  async runTest(guildId: string, test: Parameters<typeof runModuleTest>[2]): Promise<{ ok: boolean; message: string }> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild || !this.store) return { ok: false, message: 'The bot isn’t in that server (or is still starting).' };
    return runModuleTest(this.ctx, guild, test);
  }

  /** Setup Doctor for one server. */
  doctor(guildId: string): { ok: boolean; message: string; issues: ReturnType<typeof diagnose> } {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, message: 'The bot isn’t in that server (or is still starting).', issues: [] };
    return { ok: true, message: '', issues: diagnose(doctorInput(guild, this.config(guildId))) };
  }

  notifyOwner(text: string): Promise<boolean> {
    return this.client.isReady() ? notifyOwner(this.client, text) : Promise.resolve(false);
  }

  // ─── Event wiring ────────────────────────────────────────────────────────────────────────────────────────────────

  private wire(): void {
    const c = this.client;
    const ctx = this.ctx;
    // Each handler is isolated: one module failing never affects another or crashes the bot.
    const safe =
      <A extends unknown[]>(label: string, fn: (...args: A) => Promise<void>) =>
      (...args: A) => {
        if (!this.store) return;
        fn(...args).catch((e: Error) => this.log('error', `${label}: ${e.message}`));
      };

    c.on(Events.GuildCreate, (g) => void this.syncGuildCommands(g));

    c.on(
      Events.GuildMemberAdd,
      safe('Member join', async (m) => {
        // Raid protection first: someone it removes gets no welcome and isn't counted as an invite.
        const removed = await antiRaid.onMemberJoin(ctx, m);
        const invitedBy = removed ? null : await invites.onMemberJoin(ctx, m);
        if (!removed) await welcome.onMemberJoin(ctx, m);
        await logging.onMemberJoinLog(ctx, m, invitedBy);
      }),
    );
    c.on(
      Events.GuildMemberRemove,
      safe('Member leave', async (m) => {
        await welcome.onMemberLeave(ctx, m);
        invites.onMemberLeave(ctx, m.guild.id, m.id);
        onMemberLeaveXp(ctx, m.guild.id, m.id);
        await logging.onMemberLeaveLog(ctx, m);
      }),
    );

    // Automation workflows
    const startWorkflows = (guild: Guild, event: Parameters<typeof matchingWorkflows>[2], ev: Omit<Parameters<typeof runWorkflow>[3], 'guild'>) => {
      for (const w of matchingWorkflows(this.builders.workflows, guild.id, event)) void runWorkflow(ctx, this.builders, w, { guild, ...ev });
    };
    c.on(Events.GuildMemberAdd, safe('Workflows', async (m) => startWorkflows(m.guild, { type: 'memberJoin' }, { user: m.user, member: m })));
    c.on(Events.GuildMemberRemove, safe('Workflows', async (m) => startWorkflows(m.guild, { type: 'memberLeave' }, { user: m.user, member: null })));
    c.on(
      Events.GuildMemberUpdate,
      safe('Workflows', async (before, after) => {
        if (before.partial) return;
        for (const role of after.roles.cache.values()) {
          if (!before.roles.cache.has(role.id)) startWorkflows(after.guild, { type: 'roleAdded', roleId: role.id }, { user: after.user, member: after });
        }
        if (!before.premiumSince && after.premiumSince) startWorkflows(after.guild, { type: 'memberBoost' }, { user: after.user, member: after });
      }),
    );
    c.on(
      Events.MessageCreate,
      safe('Workflows', async (m) => {
        if (!m.inGuild() || m.author.bot) return;
        startWorkflows(m.guild, { type: 'messageContains', text: m.content, channelId: m.channelId }, { user: m.author, member: m.member, message: m });
      }),
    );
    c.on(
      Events.MessageReactionAdd,
      safe('Workflows', async (reaction, user) => {
        if (user.bot || !this.builders.workflows.some((w) => w.enabled && w.trigger.type === 'reactionAdded')) return;
        const r = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
        const message = r && (r.message.partial ? await r.message.fetch().catch(() => null) : r.message);
        if (!r || !message?.inGuild()) return;
        const member = await message.guild.members.fetch(user.id).catch(() => null);
        const u = user.partial ? await user.fetch() : user;
        startWorkflows(message.guild, { type: 'reactionAdded', emoji: r.emoji, channelId: message.channelId }, { user: u, member, message });
      }),
    );
    c.on(
      Events.VoiceStateUpdate,
      safe('Workflows', async (before, after) => {
        if (!after.channelId || before.channelId === after.channelId || !after.member || after.member.user.bot) return;
        startWorkflows(after.guild, { type: 'voiceJoin', channelId: after.channelId }, { user: after.member.user, member: after.member });
      }),
    );
    // Lost permissions: the bot's role was edited or removed, or one of its roles was taken away.
    const recheck = (guild: Guild) => checkLostPermissions(ctx, guild, (m) => this.problem('permissions', m));
    c.on(Events.GuildRoleUpdate, safe('Permission check', async (_before, role) => recheck(role.guild)));
    c.on(Events.GuildRoleDelete, safe('Permission check', async (role) => recheck(role.guild)));
    c.on(Events.GuildMemberUpdate, safe('Permission check', async (_before, after) => void (after.id === c.user?.id && recheck(after.guild))));
    c.on(Events.MessageCreate, safe('Auto-moderation', (m) => automodCheck(ctx, m)));
    c.on(Events.MessageCreate, safe('Leveling', (m) => onMessageXp(ctx, m)));
    c.on(Events.MessageDelete, safe('Message delete log', (m) => logging.onMessageDelete(ctx, m)));
    c.on(Events.MessageUpdate, safe('Message edit log', (a, b) => logging.onMessageEdit(ctx, a, b)));
    // Who did what: channels, roles, permissions, members, bans, server settings… (needs View Audit Log).
    c.on(Events.GuildAuditLogEntryCreate, safe('Audit log', (entry, guild) => logging.onAuditEntry(ctx, entry, guild)));
    c.on(Events.GuildAuditLogEntryCreate, safe('Moderation cases', (entry, guild) => onAuditCase(ctx, entry, guild)));
    c.on(Events.VoiceStateUpdate, safe('Voice log', (a, b) => logging.onVoice(ctx, a, b)));
    c.on(Events.VoiceStateUpdate, safe('Temporary voice', (a, b) => tempVoice.onVoiceState(ctx, a, b)));
    c.on(Events.InviteCreate, safe('Invite tracker', async (inv) => invites.onInviteCreate(inv)));
    c.on(Events.InviteDelete, safe('Invite tracker', async (inv) => invites.onInviteDelete(inv)));
    c.on(Events.MessageReactionAdd, safe('Starboard', (r) => starboard.onReaction(ctx, r)));
    c.on(Events.MessageReactionRemove, safe('Starboard', (r) => starboard.onReaction(ctx, r)));
    c.on(Events.MessageCreate, safe('Sticky messages', async (m) => sticky.onMessage(ctx, m)));

    c.on(Events.InteractionCreate, async (i) => {
      if (!this.store) return;
      if (i.isChatInputCommand()) return this.runCommand(i);
      if (i.isUserContextMenuCommand() || i.isMessageContextMenuCommand()) return this.runCustom(i);
      if (i.isButton() || i.isStringSelectMenu()) return this.runComponent(i);
      if (i.isModalSubmit()) return this.runModal(i);
    });
  }

  private async runCommand(i: ChatInputCommandInteraction): Promise<void> {
    const n = i.commandName;
    const handler = MODERATION_COMMANDS.has(n)
      ? handleModerationCommand
      : UTILITY_COMMANDS.has(n)
        ? handleUtilityCommand
        : LEVELING_COMMANDS.has(n)
          ? handleLevelingCommand
          : TICKET_COMMANDS.has(n)
            ? handleTicketCommand
            : n === 'suggest'
              ? handleSuggest
              : n === 'giveaway'
                ? handleGiveaway
                : invites.INVITE_COMMANDS.has(n)
                  ? invites.handleInvitesCommand
                  : n === 'birthday'
                    ? handleBirthdayCommand
                    : n === 'stars'
                      ? starboard.handleStarsCommand
                      : null;
    if (!handler) return this.runCustom(i); // custom command, or e.g. /ping (handled elsewhere)
    const started = Date.now();
    try {
      await handler(this.ctx, i);
      this.ctx.command(n, true, Date.now() - started);
    } catch (e) {
      this.ctx.command(n, false, Date.now() - started);
      this.log('error', `/${n} failed: ${(e as Error).message}`);
      await this.replyError(i);
    }
  }

  /** Buttons and menus on messages the bot posted. Custom IDs look like `df:<module>:<action>[:<args>]`. */
  private async runComponent(i: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
    const [prefix, kind, a, b] = i.customId.split(':');
    if (prefix !== 'df') return;
    try {
      if (i.isStringSelectMenu()) {
        if (kind === 'rrm' && a) await onRoleMenu(this.ctx, i, a);
        return;
      }
      if (i.customId === CID.ticketOpen) await onTicketOpen(this.ctx, i);
      else if (i.customId === CID.ticketClose) await onTicketClose(this.ctx, i);
      else if (i.customId === CID.ticketCloseConfirm) await onTicketCloseConfirm(this.ctx, i);
      else if (i.customId === CID.verify) await onVerify(this.ctx, i);
      else if (kind === 'rr' && a && b) await onRoleButton(this.ctx, i, a, b);
      else if (kind === 'sug' && a && b) await onSuggestionButton(this.ctx, i, a, Number(b));
      else if (kind === 'gw' && a === 'enter' && b) await onGiveawayEnter(this.ctx, i, Number(b));
    } catch (e) {
      this.log('error', `Button “${i.customId}” failed: ${(e as Error).message}`);
      await this.replyError(i);
    }
  }

  /** Pop-up forms the bot showed. Custom IDs look like `df:<module>:<action>:<args…>`. */
  private async runModal(i: ModalSubmitInteraction): Promise<void> {
    const [prefix, kind, action, a, b] = i.customId.split(':');
    if (prefix !== 'df') return;
    try {
      if (kind === 'sug' && action === 'decide' && a && b) await onSuggestionDecision(this.ctx, i, a, Number(b));
      else if (kind === 'vq' && action === 'answer') await onVerifyAnswer(this.ctx, i);
    } catch (e) {
      this.log('error', `Form “${i.customId}” failed: ${(e as Error).message}`);
      await this.replyError(i);
    }
  }

  private async runCustom(i: CommandInteraction): Promise<void> {
    const started = Date.now();
    try {
      if (await runCustomCommand(this.ctx, this.builders, i)) this.ctx.command(i.commandName, true, Date.now() - started);
    } catch (e) {
      this.ctx.command(i.commandName, false, Date.now() - started);
      this.log('error', `Custom command “${i.commandName}” failed: ${(e as Error).message}`);
      await this.replyError(i);
    }
  }

  private async replyError(i: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): Promise<void> {
    const content = 'Something went wrong. The error was written to the bot’s console in DelyForge.';
    if (i.deferred || i.replied) await i.editReply({ content }).catch(() => null);
    else await i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
}
