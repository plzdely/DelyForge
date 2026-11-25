import { IMPLEMENTED_MODULES, type ModuleTest, PERMISSIONS, modulePermissions, renderTemplate } from '@delyforge/shared';
import { type Client, type Guild, type GuildMember, Team, type User } from 'discord.js';
import { type ModuleContext, sendableChannel } from './context.js';
import { latestFeedItem } from './feeds.js';
import { sendGoodbye, sendWelcome } from './welcome.js';

/** The person who owns the bot in the Developer Portal (for a team: the team owner). */
export async function ownerOf(client: Client<true>): Promise<User | null> {
  const app = await client.application.fetch().catch(() => null);
  const o = app?.owner;
  if (!o) return null;
  return o instanceof Team ? (o.owner?.user ?? null) : o;
}

export async function notifyOwner(client: Client<true>, text: string): Promise<boolean> {
  const owner = await ownerOf(client);
  if (!owner) return false;
  return owner.send({ content: text, allowedMentions: { parse: [] } }).then(
    () => true,
    () => false, // the owner may not share a server with the bot, or has DMs closed
  );
}

// ─── Lost permissions ─────────────────────────────────────────────────────────────────────────────────────────────

const ADMINISTRATOR = 1n << 3n;
const permissionNames = (bits: bigint) =>
  PERMISSIONS.filter((p) => (bits & p.bit) !== 0n)
    .map((p) => p.label)
    .join(', ') || 'some permissions';

/** Server permissions the enabled modules need that the bot doesn't have. */
export function missingPermissions(ctx: ModuleContext, guild: Guild): bigint {
  const configs = ctx.config(guild.id);
  let need = 0n;
  for (const id of IMPLEMENTED_MODULES) need |= modulePermissions(id, configs[id] as never);
  const have = guild.members.me?.permissions.bitfield ?? 0n;
  return have & ADMINISTRATOR ? 0n : need & ~have;
}

const lastMissing = new Map<string, bigint>();

/**
 * Compares with the last check. `baseline` (startup, settings changed) only records the state, so turning on a module
 * the bot never had rights for isn't reported as "lost" — the module screen and Setup Doctor show that.
 */
export function checkLostPermissions(ctx: ModuleContext, guild: Guild, report: (message: string) => void, baseline = false): void {
  const missing = missingPermissions(ctx, guild);
  const before = lastMissing.get(guild.id);
  lastMissing.set(guild.id, missing);
  if (baseline || before === undefined) return;
  const lost = missing & ~before;
  if (lost) {
    report(
      `In “${guild.name}” the bot lost: ${permissionNames(lost)}. Modules that need them may stop working. Fix it in Server Settings → Roles → the bot’s role.`,
    );
  }
}

// ─── "Send a test" buttons ────────────────────────────────────────────────────────────────────────────────────────

const CHECK_CONSOLE = 'Couldn’t post — the bot console says why (usually a missing channel or permission).';

/** Runs one test with the owner as the example member (or the bot itself if the owner isn't in the server). */
export async function runModuleTest(ctx: ModuleContext, guild: Guild, test: ModuleTest): Promise<{ ok: boolean; message: string }> {
  const config = ctx.config(guild.id);
  const owner = await ownerOf(ctx.client);
  const member: GuildMember | null = (owner && (await guild.members.fetch(owner.id).catch(() => null))) ?? guild.members.me;
  if (!member) return { ok: false, message: 'The bot isn’t ready in this server yet.' };
  const vars = { user: `<@${member.id}>`, 'user.name': member.displayName, 'user.id': member.id, server: guild.name, memberCount: guild.memberCount };
  const post = async (channelId: string | null, content: string, purpose: string) => {
    const channel = await sendableChannel(ctx, guild, channelId, purpose);
    if (!channel) return { ok: false, message: channelId ? CHECK_CONSOLE : 'Choose a channel first.' };
    // Tests never ping roles or @everyone; only the example member is mentioned.
    const sent = await channel.send({ content: content.slice(0, 2000), allowedMentions: { users: [member.id] } }).then(
      () => true,
      (e: Error) => (ctx.log('warn', `${purpose} test: ${e.message}`), false),
    );
    return sent ? { ok: true, message: `Posted in #${channel.name}.` } : { ok: false, message: CHECK_CONSOLE };
  };

  switch (test) {
    case 'welcome': {
      if (!config.welcome.welcome.enabled && !config.welcome.dm.enabled) return { ok: false, message: 'Turn on the welcome message or the welcome DM first.' };
      const r = await sendWelcome(ctx, member);
      const parts = [r.posted ? 'posted the welcome message' : config.welcome.welcome.enabled ? 'couldn’t post the welcome message (see the console)' : '', r.dm ? 'sent the welcome DM to you' : config.welcome.dm.enabled ? 'couldn’t DM you (DMs closed?)' : ''].filter(Boolean);
      return { ok: r.posted || r.dm, message: `Test with you as the new member: ${parts.join(' and ')}.` };
    }
    case 'goodbye':
      if (!config.welcome.goodbye.enabled) return { ok: false, message: 'Turn on the goodbye message first.' };
      return (await sendGoodbye(ctx, member)) ? { ok: true, message: 'Posted the goodbye message (with you as the example).' } : { ok: false, message: CHECK_CONSOLE };
    case 'levelUp': {
      const c = config.leveling.levelUp;
      if (!c.enabled || !c.message.trim()) return { ok: false, message: 'Turn on level-up messages first.' };
      if (!c.channelId) return { ok: false, message: 'Level-ups are posted where the member chatted. Choose a fixed channel to test it here.' };
      return post(c.channelId, renderTemplate(c.message, { ...vars, level: 5 }), 'Level-up message');
    }
    case 'birthday':
      return post(config.birthdays.channelId, renderTemplate(config.birthdays.message, vars), 'Birthdays');
    case 'scheduled': {
      const m = config.scheduled.messages[0];
      if (!m) return { ok: false, message: 'Add a scheduled message first.' };
      return post(m.channelId, m.text, 'Scheduled messages');
    }
    case 'feeds': {
      const feed = config.feeds.feeds[0];
      if (!feed) return { ok: false, message: 'Add a feed first.' };
      let item;
      try {
        item = await latestFeedItem(feed);
      } catch (e) {
        return { ok: false, message: `Couldn’t read the feed: ${(e as Error).message}` };
      }
      if (!item) return { ok: false, message: 'The feed has no posts yet.' };
      return post(feed.channelId, renderTemplate(feed.message, { title: item.title, link: item.link, author: item.author, role: '' }), 'Social alerts');
    }
  }
}
