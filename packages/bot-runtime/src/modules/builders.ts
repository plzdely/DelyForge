import {
  type Builders,
  type CustomCommand,
  type EmbedTemplate,
  WORKFLOW_LIMITS,
  type Workflow,
  type WorkflowStep,
  renderTemplate,
} from '@delyforge/shared';
import {
  type APIEmbed,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ButtonStyle,
  type CommandInteraction,
  ComponentType,
  type Guild,
  type GuildMember,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
  type RESTPostAPIApplicationCommandsJSONBody,
  type User,
} from 'discord.js';
import { type ModuleContext, hexToInt, sendableChannel } from './context.js';
import { assignable } from './roles.js';

type Vars = Record<string, string | number>;

// ─── Custom command definitions ───────────────────────────────────────────────────────────────────────────────────

const OPTION_TYPES = { text: ApplicationCommandOptionType.String, user: ApplicationCommandOptionType.User, number: ApplicationCommandOptionType.Number } as const;
const ACCESS = { everyone: null, moderators: PermissionFlagsBits.ManageMessages, admins: PermissionFlagsBits.ManageGuild } as const;

/** Key used to track a command DelyForge created. Right-click commands may share a name with a slash command. */
export const commandKey = (c: Pick<CustomCommand, 'type' | 'name'>) => (c.type === 'slash' ? c.name : `${c.type}:${c.name}`);

export function customCommandJSON(c: CustomCommand): RESTPostAPIApplicationCommandsJSONBody {
  const perms = ACCESS[c.access];
  const common = { name: c.name, dm_permission: false, default_member_permissions: perms === null ? null : perms.toString() };
  if (c.type === 'user') return { ...common, type: ApplicationCommandType.User };
  if (c.type === 'message') return { ...common, type: ApplicationCommandType.Message };
  return {
    ...common,
    type: ApplicationCommandType.ChatInput,
    description: c.description,
    options: c.options.map((o) => ({ type: OPTION_TYPES[o.type], name: o.name, description: o.description, required: o.required })),
  } as RESTPostAPIApplicationCommandsJSONBody;
}

// ─── Rendering ────────────────────────────────────────────────────────────────────────────────────────────────────

export function renderEmbed(e: EmbedTemplate, vars: Vars): APIEmbed {
  const t = (s: string) => (s ? renderTemplate(s, vars) : undefined);
  return {
    title: t(e.title),
    url: e.url || undefined,
    description: t(e.description),
    color: hexToInt(e.color),
    author: e.authorName ? { name: t(e.authorName)!, icon_url: e.authorIconUrl || undefined } : undefined,
    thumbnail: e.thumbnailUrl ? { url: e.thumbnailUrl } : undefined,
    image: e.imageUrl ? { url: e.imageUrl } : undefined,
    footer: e.footerText ? { text: t(e.footerText)!, icon_url: e.footerIconUrl || undefined } : undefined,
    timestamp: e.timestamp ? new Date().toISOString() : undefined,
    fields: e.fields.map((f) => ({ name: renderTemplate(f.name, vars), value: renderTemplate(f.value, vars), inline: f.inline })),
  };
}

function memberVars(guild: Guild, user: User, displayName: string): Vars {
  return { user: `<@${user.id}>`, 'user.name': displayName, 'user.id': user.id, server: guild.name, memberCount: guild.memberCount };
}

// ─── Running custom commands ──────────────────────────────────────────────────────────────────────────────────────

const cooldowns = new Map<string, number>();

/** True if this user may run the command now (and starts their cooldown). */
export function takeCooldown(key: string, seconds: number, now: number, map: Map<string, number> = cooldowns): number {
  if (seconds <= 0) return 0;
  const until = map.get(key) ?? 0;
  if (until > now) return Math.ceil((until - now) / 1000);
  map.set(key, now + seconds * 1000);
  if (map.size > 10_000) for (const [k, v] of map) if (v <= now) map.delete(k);
  return 0;
}

export async function runCustomCommand(ctx: ModuleContext, builders: Builders, i: CommandInteraction): Promise<boolean> {
  if (!i.inCachedGuild()) return false;
  const type = i.isChatInputCommand() ? 'slash' : i.isUserContextMenuCommand() ? 'user' : 'message';
  const cmd = builders.commands.find((c) => c.enabled && c.type === type && c.name === i.commandName);
  if (!cmd) return false;

  const wait = takeCooldown(`${i.guildId}:${cmd.id}:${i.user.id}`, cmd.cooldownSeconds, Date.now());
  if (wait) {
    await i.reply({ content: `Slow down — try again in ${wait}s.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  const vars: Vars = { ...memberVars(i.guild, i.user, i.member.displayName), channel: `<#${i.channelId}>` };
  if (i.isChatInputCommand()) {
    for (const o of cmd.options) {
      const v = o.type === 'user' ? i.options.getUser(o.name) : o.type === 'number' ? i.options.getNumber(o.name) : i.options.getString(o.name);
      vars[`option:${o.name}`] = v === null ? '' : typeof v === 'object' ? `<@${v.id}>` : String(v);
    }
  } else if (i.isUserContextMenuCommand()) {
    vars['target'] = `<@${i.targetUser.id}>`;
  } else if (i.isMessageContextMenuCommand()) {
    vars['target'] = `<@${i.targetMessage.author.id}>`;
  }

  const embed = cmd.response.embedId ? builders.embeds.find((e) => e.id === cmd.response.embedId) : undefined;
  await i.reply({
    content: cmd.response.text ? renderTemplate(cmd.response.text, vars) : undefined,
    embeds: embed ? [renderEmbed(embed, vars)] : undefined,
    components: cmd.response.buttons.length
      ? [{ type: ComponentType.ActionRow, components: cmd.response.buttons.map((b) => ({ type: ComponentType.Button, style: ButtonStyle.Link, label: b.label, url: b.url })) }]
      : undefined,
    flags: cmd.response.ephemeral ? MessageFlags.Ephemeral : undefined,
    allowedMentions: { parse: ['users'] },
  });
  return true;
}

// ─── Workflow engine ──────────────────────────────────────────────────────────────────────────────────────────────

export interface WorkflowEvent {
  guild: Guild;
  user: User;
  member: GuildMember | null;
  message?: Message;
  roleId?: string;
}

const recentRuns = new Map<string, number[]>();

/** At most `runsPerMinute` runs per workflow, so a raid or spam can't turn a workflow into a message flood. */
export function allowRun(workflowId: string, now: number, map: Map<string, number[]> = recentRuns): boolean {
  const ts = (map.get(workflowId) ?? []).filter((t) => t > now - 60_000);
  if (ts.length >= WORKFLOW_LIMITS.runsPerMinute) {
    map.set(workflowId, ts);
    return false;
  }
  ts.push(now);
  map.set(workflowId, ts);
  return true;
}

/** Workflows a Discord event should start. */
export function matchingWorkflows(workflows: readonly Workflow[], guildId: string, event: { type: 'memberJoin' | 'memberLeave' | 'messageContains' | 'roleAdded'; text?: string; channelId?: string; roleId?: string }): Workflow[] {
  return workflows.filter((w) => {
    if (!w.enabled || w.guildId !== guildId || w.trigger.type !== event.type) return false;
    const t = w.trigger;
    if (t.type === 'messageContains') return (!t.channelId || t.channelId === event.channelId) && (event.text ?? '').toLowerCase().includes(t.keyword.toLowerCase());
    if (t.type === 'roleAdded') return t.roleId === event.roleId;
    return true;
  });
}

export async function runWorkflow(ctx: ModuleContext, builders: Builders, w: Workflow, ev: WorkflowEvent, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
  if (!allowRun(w.id, Date.now())) {
    ctx.workflowRun({ workflowId: w.id, ok: false, steps: 0, message: 'Skipped: ran too often in the last minute (limit 30).' });
    return;
  }
  const vars: Vars = { ...memberVars(ev.guild, ev.user, ev.member?.displayName ?? ev.user.username), channel: ev.message ? `<#${ev.message.channelId}>` : '' };
  let done = 0;
  try {
    for (const step of w.steps) {
      const stop = await runStep(ctx, builders, step, ev, vars, sleep);
      done++;
      if (stop) {
        ctx.workflowRun({ workflowId: w.id, ok: true, steps: done, message: `Stopped at step ${done}: ${stop}` });
        return;
      }
    }
    ctx.workflowRun({ workflowId: w.id, ok: true, steps: done, message: `Completed ${done} step(s) for ${ev.user.username}.` });
  } catch (e) {
    ctx.workflowRun({ workflowId: w.id, ok: false, steps: done, message: `Step ${done + 1} failed: ${(e as Error).message}` });
  }
}

/** Runs one step. Returns a reason string if the workflow should stop here (a condition wasn't met). */
async function runStep(ctx: ModuleContext, builders: Builders, s: WorkflowStep, ev: WorkflowEvent, vars: Vars, sleep: (ms: number) => Promise<unknown>): Promise<string | null> {
  switch (s.type) {
    case 'wait':
      await sleep(s.seconds * 1000);
      return null;
    case 'sendMessage': {
      const channel = await sendableChannel(ctx, ev.guild, s.channelId, 'Workflow');
      if (!channel) throw new Error('channel not available');
      const embed = s.embedId ? builders.embeds.find((e) => e.id === s.embedId) : undefined;
      await channel.send({ content: s.text ? renderTemplate(s.text, vars) : undefined, embeds: embed ? [renderEmbed(embed, vars)] : undefined, allowedMentions: { parse: ['users'] } });
      return null;
    }
    case 'reply':
      await ev.message?.reply({ content: renderTemplate(s.text, vars), allowedMentions: { parse: ['users'] } });
      return null;
    case 'sendDM':
      await ev.user.send({ content: renderTemplate(s.text, vars), allowedMentions: { parse: [] } }).catch(() => null); // DMs may be closed
      return null;
    case 'deleteMessage':
      await ev.message?.delete();
      return null;
    case 'addRole':
    case 'removeRole': {
      if (!ev.member) throw new Error('member not available');
      if (!assignable(ev.member, [s.roleId]).length) throw new Error('the role is above the bot’s role or managed');
      if (s.type === 'addRole') await ev.member.roles.add(s.roleId, 'DelyForge workflow');
      else await ev.member.roles.remove(s.roleId, 'DelyForge workflow');
      return null;
    }
    case 'ifHasRole': {
      const has = ev.member?.roles.cache.has(s.roleId) ?? false;
      return has !== s.negate ? null : s.negate ? 'member has the role' : 'member doesn’t have the role';
    }
    case 'ifAccountOlderThan': {
      const days = (Date.now() - ev.user.createdTimestamp) / 86_400_000;
      return days >= s.days ? null : `account younger than ${s.days} day(s)`;
    }
  }
}
