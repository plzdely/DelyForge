import {
  type Builders,
  type CustomCommand,
  type EmbedTemplate,
  WORKFLOW_LIMITS,
  type Workflow,
  type WorkflowCondition,
  type WorkflowStep,
  renderTemplate,
  workflowBlocks,
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
import { localParts } from './scheduled.js';
import { emojiMatches } from './starboard.js';

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
  /** Null for scheduled runs (nobody started them). */
  user: User | null;
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

export type TriggerEvent =
  | { type: 'memberJoin' | 'memberLeave' | 'memberBoost' }
  | { type: 'messageContains'; text: string; channelId: string }
  | { type: 'roleAdded'; roleId: string }
  | { type: 'reactionAdded'; emoji: { id: string | null; name: string | null }; channelId: string }
  | { type: 'voiceJoin'; channelId: string }
  | { type: 'schedule'; at: { day: number; time: string } };

/** Workflows a Discord event should start. */
export function matchingWorkflows(workflows: readonly Workflow[], guildId: string, event: TriggerEvent): Workflow[] {
  return workflows.filter((w) => {
    if (!w.enabled || w.guildId !== guildId || w.trigger.type !== event.type) return false;
    const t = w.trigger;
    if (t.type === 'messageContains' && event.type === 'messageContains') return (!t.channelId || t.channelId === event.channelId) && event.text.toLowerCase().includes(t.keyword.toLowerCase());
    if (t.type === 'roleAdded' && event.type === 'roleAdded') return t.roleId === event.roleId;
    if (t.type === 'reactionAdded' && event.type === 'reactionAdded') return (!t.channelId || t.channelId === event.channelId) && emojiMatches(t.emoji, event.emoji);
    if (t.type === 'voiceJoin' && event.type === 'voiceJoin') return !t.channelId || t.channelId === event.channelId;
    if (t.type === 'schedule' && event.type === 'schedule') return t.time === event.at.time && (!t.days.length || t.days.includes(event.at.day));
    return true;
  });
}

/** Scheduled workflows due now in their own time zone (checked every 30 s; each runs once per minute). */
const scheduleSent = new Set<string>();
export function dueScheduledWorkflows(workflows: readonly Workflow[], guildId: string, now: Date, sent = scheduleSent): Workflow[] {
  if (sent.size > 2000) sent.clear();
  return workflows.filter((w) => {
    if (w.trigger.type !== 'schedule') return false;
    const at = localParts(now, w.trigger.timezone) ?? localParts(now, 'UTC')!;
    if (!matchingWorkflows([w], guildId, { type: 'schedule', at }).length) return false;
    const key = `${w.id}:${at.date} ${at.time}`;
    if (sent.has(key)) return false;
    sent.add(key);
    return true;
  });
}

/** Checks for "If" blocks: hasRole / accountOlderThan / text comparison. */
export function checkCondition(c: WorkflowCondition, ev: Pick<WorkflowEvent, 'user' | 'member'>, vars: Vars, now = Date.now()): boolean {
  switch (c.kind) {
    case 'hasRole':
      return (ev.member?.roles.cache.has(c.roleId) ?? false) !== c.negate;
    case 'accountOlderThan':
      return ev.user ? (now - ev.user.createdTimestamp) / 86_400_000 >= c.days : false;
    case 'text': {
      const a = renderTemplate(c.text, vars).trim();
      const b = renderTemplate(c.value, vars).trim();
      const na = Number(a);
      const nb = Number(b);
      const numbers = a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb);
      const result =
        c.op === 'equals' ? (numbers ? na === nb : a.toLowerCase() === b.toLowerCase())
        : c.op === 'contains' ? a.toLowerCase().includes(b.toLowerCase())
        : c.op === 'greaterThan' ? numbers && na > nb
        : numbers && na < nb;
      return result !== c.negate;
    }
  }
}

export async function runWorkflow(ctx: ModuleContext, builders: Builders, w: Workflow, ev: WorkflowEvent, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
  if (!allowRun(w.id, Date.now())) {
    ctx.workflowRun({ workflowId: w.id, ok: false, steps: 0, message: 'Skipped: ran too often in the last minute (limit 30).' });
    return;
  }
  const vars: Vars = ev.user
    ? { ...memberVars(ev.guild, ev.user, ev.member?.displayName ?? ev.user.username), channel: ev.message ? `<#${ev.message.channelId}>` : '' }
    : { server: ev.guild.name, memberCount: ev.guild.memberCount, channel: '' };
  for (const [name, value] of Object.entries(ctx.store.workflowVars(ev.guild.id))) vars[`var:${name}`] = value;
  const blocks = workflowBlocks(w.steps) ?? new Map();
  const who = ev.user ? ` for ${ev.user.username}` : '';
  let done = 0;
  try {
    for (let pc = 0; pc < w.steps.length; ) {
      const step = w.steps[pc]!;
      done++;
      if (step.type === 'if') {
        const block = blocks.get(pc);
        const pass = checkCondition(step.check, ev, vars);
        pc = pass || !block ? pc + 1 : (block.else ?? block.end) + 1;
        continue;
      }
      if (step.type === 'else') {
        // Reached the end of the "If" part: skip the "Otherwise" part.
        const owner = [...blocks.values()].find((b) => b.else === pc);
        pc = owner ? owner.end + 1 : pc + 1;
        continue;
      }
      const stop = await runStep(ctx, builders, step, ev, vars, sleep);
      if (stop) {
        ctx.workflowRun({ workflowId: w.id, ok: true, steps: done, message: `Stopped at step ${pc + 1}: ${stop}` });
        return;
      }
      pc++;
    }
    ctx.workflowRun({ workflowId: w.id, ok: true, steps: done, message: `Completed ${done} step(s)${who}.` });
  } catch (e) {
    ctx.workflowRun({ workflowId: w.id, ok: false, steps: done - 1, message: `Step failed: ${(e as Error).message}` });
  }
}

const needMember = (ev: WorkflowEvent) => {
  if (!ev.member) throw new Error('member not available');
  return ev.member;
};

/** Runs one step. Returns a reason string if the workflow should stop here (a condition wasn't met). */
async function runStep(ctx: ModuleContext, builders: Builders, s: WorkflowStep, ev: WorkflowEvent, vars: Vars, sleep: (ms: number) => Promise<unknown>): Promise<string | null> {
  switch (s.type) {
    case 'wait':
      await sleep(s.seconds * 1000);
      return null;
    case 'sendMessage':
    case 'sendRandom': {
      const channel = await sendableChannel(ctx, ev.guild, s.channelId, 'Workflow');
      if (!channel) throw new Error('channel not available');
      if (s.type === 'sendRandom') {
        await channel.send({ content: renderTemplate(s.texts[Math.floor(Math.random() * s.texts.length)]!, vars), allowedMentions: { parse: ['users'] } });
        return null;
      }
      const embed = s.embedId ? builders.embeds.find((e) => e.id === s.embedId) : undefined;
      await channel.send({ content: s.text ? renderTemplate(s.text, vars) : undefined, embeds: embed ? [renderEmbed(embed, vars)] : undefined, allowedMentions: { parse: ['users'] } });
      return null;
    }
    case 'reply':
      await ev.message?.reply({ content: renderTemplate(s.text, vars), allowedMentions: { parse: ['users'] } });
      return null;
    case 'sendDM':
      await ev.user?.send({ content: renderTemplate(s.text, vars), allowedMentions: { parse: [] } }).catch(() => null); // DMs may be closed
      return null;
    case 'deleteMessage':
      await ev.message?.delete();
      return null;
    case 'createThread': {
      if (!ev.message) throw new Error('message not available');
      if (ev.message.hasThread) return null;
      await ev.message.startThread({ name: renderTemplate(s.name, vars).slice(0, 100) || 'Thread', reason: 'DelyForge workflow' });
      return null;
    }
    case 'addRole':
    case 'removeRole': {
      const member = needMember(ev);
      if (!assignable(member, [s.roleId]).length) throw new Error('the role is above the bot’s role or managed');
      if (s.type === 'addRole') await member.roles.add(s.roleId, 'DelyForge workflow');
      else await member.roles.remove(s.roleId, 'DelyForge workflow');
      return null;
    }
    case 'timeout': {
      const member = needMember(ev);
      if (!member.moderatable) throw new Error('the bot can’t time out this member (role too high, or it lacks Timeout Members)');
      await member.timeout(s.minutes * 60_000, 'DelyForge workflow');
      return null;
    }
    case 'setVariable': {
      const value = renderTemplate(s.value, vars);
      const next = s.mode === 'add' ? String((Number(vars[`var:${s.name}`]) || 0) + (Number(value) || 0)) : value.slice(0, 200);
      ctx.store.setWorkflowVar(ev.guild.id, s.name, next);
      vars[`var:${s.name}`] = next;
      return null;
    }
    case 'ifHasRole': {
      const has = ev.member?.roles.cache.has(s.roleId) ?? false;
      return has !== s.negate ? null : s.negate ? 'member has the role' : 'member doesn’t have the role';
    }
    case 'ifAccountOlderThan': {
      const days = ev.user ? (Date.now() - ev.user.createdTimestamp) / 86_400_000 : 0;
      return days >= s.days ? null : `account younger than ${s.days} day(s)`;
    }
    case 'if':
    case 'else':
    case 'endIf':
      return null; // handled by runWorkflow
  }
}
