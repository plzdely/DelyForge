import {
  ActivityType,
  Client,
  Events,
  Partials,
  type PresenceStatusData,
} from 'discord.js';
import { ModuleHost } from './modules/host.js';
import type { BotPresence, RuntimeOptions } from '@delyforge/shared';
import type { BotClient, BotClientEvents } from './runtime.js';

const ACTIVITY_TYPES = {
  playing: ActivityType.Playing,
  listening: ActivityType.Listening,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom,
} as const;

/** The real discord.js-backed client used in production. */
export function createDiscordClient(options: RuntimeOptions, events: BotClientEvents): BotClient {
  // Partials let logging report deletes/edits of messages sent before the bot started.
  const client = new Client({ intents: options.intents, partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.Reaction, Partials.User] });
  const modules = new ModuleHost(client, options, events.log, events.command, events.workflowRun, events.problem);

  client.once(Events.ClientReady, async (c) => {
    events.ready({
      id: c.user.id,
      tag: c.user.tag,
      avatarUrl: c.user.displayAvatarURL({ size: 128 }),
      guildCount: c.guilds.cache.size,
    });
    try {
      await modules.onReady();
    } catch (err) {
      events.log('error', `Modules could not start: ${(err as Error).message}`);
    }
    if (options.builtinPing) {
      try {
        // `create` adds or updates only this one command — it never removes the application's other commands.
        await c.application.commands.create({ name: 'ping', description: 'Check that the bot is online and see its latency' });
        events.log('info', 'Registered the /ping command (it can take a minute to appear in Discord).');
      } catch (err) {
        events.log('warn', `Could not register /ping: ${(err as Error).message}`);
      }
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const started = Date.now();
    if (interaction.commandName === 'ping' && options.builtinPing) {
      try {
        const ping = client.ws.ping;
        await interaction.reply({
          content: `🏓 Pong! Gateway latency: ${ping >= 0 ? `${ping} ms` : 'measuring…'} — powered by DelyForge`,
        });
        events.command('ping', true, Date.now() - started);
      } catch (err) {
        events.command('ping', false, Date.now() - started);
        events.log('error', `/ping failed: ${(err as Error).message}`);
      }
    }
  });

  client.on(Events.GuildCreate, (g) => events.log('info', `Joined server “${g.name}”.`));
  client.on(Events.GuildDelete, (g) => events.log('info', `Removed from server “${g.name ?? g.id}”.`));
  client.on(Events.Warn, (m) => events.log('warn', m));
  client.on(Events.Error, (e) => events.log('error', e.message));
  client.on(Events.ShardDisconnect, (e) => {
    events.log('warn', `Disconnected from Discord (code ${e.code}).`);
    events.connection('disconnected');
  });
  client.on(Events.ShardReconnecting, () => {
    events.log('info', 'Reconnecting to Discord…');
    events.connection('reconnecting');
  });
  client.on(Events.ShardResume, () => {
    events.log('info', 'Connection resumed.');
    events.connection('resumed');
  });

  return {
    login: async (token) => {
      await client.login(token);
    },
    destroy: async () => {
      await client.destroy();
      modules.close();
    },
    setModules: (m) => modules.setModules(m),
    setBuilders: (b) => modules.setBuilders(b),
    runTest: (guildId, test) => modules.runTest(guildId, test),
    notifyOwner: (text) => modules.notifyOwner(text),
    doctor: (guildId) => modules.doctor(guildId),
    setPresence: (presence: BotPresence) => {
      if (!client.user) return;
      const a = presence.activity;
      client.user.setPresence({
        status: presence.status as PresenceStatusData,
        activities: a
          ? [a.type === 'custom' ? { name: 'Custom Status', state: a.text, type: ActivityType.Custom } : { name: a.text, type: ACTIVITY_TYPES[a.type] }]
          : [],
      });
    },
    ping: () => (client.ws.ping >= 0 ? client.ws.ping : null),
    guildCount: () => client.guilds.cache.size,
  };
}
