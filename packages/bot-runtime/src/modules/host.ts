import { type BotModules, type LogLevel, type ModuleConfigs, resolveGuildModules } from '@delyforge/shared';
import { type Client, Events, type Guild, MessageFlags } from 'discord.js';
import { BotStore, planCommandSync } from '../store.js';
import { commandHash, desiredCommands } from './commands.js';
import type { ModuleContext } from './context.js';
import * as logging from './logging.js';
import { MODERATION_COMMANDS, automodCheck, handleModerationCommand } from './moderation.js';
import { UTILITY_COMMANDS, handleUtilityCommand } from './utility.js';
import * as welcome from './welcome.js';

/**
 * Connects Discord events to the enabled modules, per server, and keeps each server's slash commands in line with
 * its settings. Settings can be replaced at any time (`setModules`) without reconnecting.
 */
export class ModuleHost {
  private modules: BotModules;
  private store: BotStore | null = null;
  private syncing = new Set<string>();
  private readonly ctx: ModuleContext;

  constructor(
    private readonly client: Client,
    initial: BotModules,
    private readonly dataDir: string,
    private readonly log: (level: LogLevel, message: string) => void,
    command: (name: string, ok: boolean, durationMs: number) => void,
  ) {
    this.modules = initial;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const host = this;
    this.ctx = {
      client: client as Client<true>,
      get store() {
        return host.requireStore();
      },
      log,
      command,
      config: (guildId) => this.config(guildId),
    };
    this.wire();
  }

  config(guildId: string): ModuleConfigs {
    return resolveGuildModules(this.modules[guildId]);
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
  }

  close(): void {
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

  /** Creates, updates and removes only the commands DelyForge itself manages in this server. */
  private async syncGuildCommands(guild: Guild): Promise<void> {
    if (!this.store || this.syncing.has(guild.id)) return;
    this.syncing.add(guild.id);
    try {
      const desired = desiredCommands(this.config(guild.id));
      const byName = new Map(desired.map((c) => [c.name, c]));
      const plan = planCommandSync(
        desired.map((c) => ({ name: c.name, hash: commandHash(c) })),
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
    } catch (e) {
      this.log('warn', `Could not update slash commands in “${guild.name}”: ${(e as Error).message}`);
    } finally {
      this.syncing.delete(guild.id);
    }
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
        await welcome.onMemberJoin(ctx, m);
        await logging.onMemberJoinLog(ctx, m);
      }),
    );
    c.on(
      Events.GuildMemberRemove,
      safe('Member leave', async (m) => {
        await welcome.onMemberLeave(ctx, m);
        await logging.onMemberLeaveLog(ctx, m);
      }),
    );
    c.on(Events.GuildMemberUpdate, safe('Member update', (a, b) => logging.onMemberUpdateLog(ctx, a, b)));
    c.on(Events.MessageCreate, safe('Auto-moderation', (m) => automodCheck(ctx, m)));
    c.on(Events.MessageDelete, safe('Message delete log', (m) => logging.onMessageDelete(ctx, m)));
    c.on(Events.MessageUpdate, safe('Message edit log', (a, b) => logging.onMessageEdit(ctx, a, b)));
    c.on(Events.ChannelCreate, safe('Channel log', (ch) => logging.onChannelChange(ctx, ch, 'created')));
    c.on(
      Events.ChannelDelete,
      safe('Channel log', async (ch) => {
        if (!ch.isDMBased()) await logging.onChannelChange(ctx, ch, 'deleted');
      }),
    );
    c.on(Events.GuildBanAdd, safe('Ban log', (b) => logging.onBan(ctx, b, 'banned')));
    c.on(Events.GuildBanRemove, safe('Ban log', (b) => logging.onBan(ctx, b, 'unbanned')));
    c.on(Events.VoiceStateUpdate, safe('Voice log', (a, b) => logging.onVoice(ctx, a, b)));

    c.on(Events.InteractionCreate, async (i) => {
      if (!i.isChatInputCommand() || !this.store) return;
      const isMod = MODERATION_COMMANDS.has(i.commandName);
      const isUtil = UTILITY_COMMANDS.has(i.commandName);
      if (!isMod && !isUtil) return;
      const started = Date.now();
      try {
        if (isMod) await handleModerationCommand(ctx, i);
        else await handleUtilityCommand(ctx, i);
        ctx.command(i.commandName, true, Date.now() - started);
      } catch (e) {
        ctx.command(i.commandName, false, Date.now() - started);
        this.log('error', `/${i.commandName} failed: ${(e as Error).message}`);
        const content = 'Something went wrong running that command. The error was written to the bot’s console in DelyForge.';
        if (i.deferred || i.replied) await i.editReply({ content }).catch(() => null);
        else await i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    });
  }
}
