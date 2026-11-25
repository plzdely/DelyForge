import { z } from 'zod';
import { snowflakeSchema } from './discord.js';

/**
 * Builders (Phase 5): custom commands, saved embeds and automation workflows. All of it is data validated by these
 * schemas — the bot runtime interprets it with fixed, built-in behaviour and never runs user-supplied code.
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7c5cff');
const httpsUrl = z.url({ protocol: /^https$/, message: 'Use a full https:// link' }).max(2048);
const optionalUrl = z.union([z.literal(''), httpsUrl]);
const itemId = z.string().regex(/^[a-z0-9]{1,16}$/);

// ─── Embeds ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Discord's embed limits (https://discord.com/developers/docs/resources/message#embed-object-embed-limits). */
export const EMBED_LIMITS = { title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, total: 6000 } as const;

export const embedFieldSchema = z
  .object({
    name: z.string().trim().min(1, 'Every field needs a name').max(EMBED_LIMITS.fieldName),
    value: z.string().trim().min(1, 'Every field needs a value').max(EMBED_LIMITS.fieldValue),
    inline: z.boolean(),
  })
  .strict();

export const embedSchema = z
  .object({
    id: itemId,
    /** Name shown in DelyForge only. */
    name: z.string().trim().min(1, 'Give the embed a name').max(60),
    title: z.string().max(EMBED_LIMITS.title),
    url: optionalUrl,
    description: z.string().max(EMBED_LIMITS.description),
    color: hexColor,
    authorName: z.string().max(EMBED_LIMITS.author),
    authorIconUrl: optionalUrl,
    thumbnailUrl: optionalUrl,
    imageUrl: optionalUrl,
    footerText: z.string().max(EMBED_LIMITS.footer),
    footerIconUrl: optionalUrl,
    timestamp: z.boolean(),
    fields: z.array(embedFieldSchema).max(EMBED_LIMITS.fields),
  })
  .strict()
  .superRefine((e, ctx) => {
    const total = embedCharacterCount(e);
    if (total > EMBED_LIMITS.total) ctx.addIssue({ code: 'custom', message: `Discord allows ${EMBED_LIMITS.total} characters per embed; this one has ${total}.` });
    if (!e.title && !e.description && !e.fields.length && !e.imageUrl && !e.authorName) {
      ctx.addIssue({ code: 'custom', message: 'An embed needs at least a title, description, field, image or author.' });
    }
  });
export type EmbedTemplate = z.infer<typeof embedSchema>;

/** Characters Discord counts toward the 6,000 limit. */
export function embedCharacterCount(e: Pick<EmbedTemplate, 'title' | 'description' | 'authorName' | 'footerText' | 'fields'>): number {
  return e.title.length + e.description.length + e.authorName.length + e.footerText.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
}

export const blankEmbed = (id: string): EmbedTemplate => ({
  id,
  name: 'New embed',
  title: 'Hello!',
  url: '',
  description: 'Write something here.',
  color: '#7c5cff',
  authorName: '',
  authorIconUrl: '',
  thumbnailUrl: '',
  imageUrl: '',
  footerText: '',
  footerIconUrl: '',
  timestamp: false,
  fields: [],
});

// ─── Custom commands ──────────────────────────────────────────────────────────────────────────────────────────────

/** Names DelyForge's own modules use — custom commands can't take them. */
export const RESERVED_COMMAND_NAMES = [
  'ping', 'warn', 'warnings', 'clearwarnings', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge',
  'serverinfo', 'userinfo', 'avatar', 'poll', 'rank', 'leaderboard', 'ticket', 'suggest', 'giveaway',
  'history', 'case', 'note', 'lock', 'unlock', 'slowmode', 'softban', 'role', 'nick', 'xp', 'invites', 'inviteboard',
  'birthday', 'stars', 'voice', 'remind', 'roll', 'unwarn',
] as const;

const commandName = z
  .string()
  .regex(/^[a-z0-9_-]{1,32}$/, 'Use 1–32 lowercase letters, numbers, - or _ (Discord’s rule for slash commands)')
  .refine((n) => !(RESERVED_COMMAND_NAMES as readonly string[]).includes(n), 'That name is used by a DelyForge module');

export const commandOptionSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9_-]{1,32}$/, 'Option names: 1–32 lowercase letters, numbers, - or _'),
    description: z.string().trim().min(1).max(100),
    type: z.enum(['text', 'user', 'number']),
    required: z.boolean(),
  })
  .strict();

export const linkButtonSchema = z.object({ label: z.string().trim().min(1).max(80), url: httpsUrl }).strict();

export const customCommandSchema = z
  .object({
    id: itemId,
    enabled: z.boolean(),
    /** slash = /name; user / message = right-click menu commands (Apps → name). */
    type: z.enum(['slash', 'user', 'message']),
    /** Slash: lowercase rules. User/message commands allow spaces and capitals. */
    name: z.string().min(1).max(32),
    description: z.string().trim().max(100),
    options: z.array(commandOptionSchema).max(5),
    /** Who can see/use it. Server admins can fine-tune further in Discord (Server Settings → Integrations). */
    access: z.enum(['everyone', 'moderators', 'admins']),
    cooldownSeconds: z.number().int().min(0).max(86400),
    response: z
      .object({
        text: z.string().max(2000),
        /** ID of a saved embed, or '' for none. */
        embedId: z.union([z.literal(''), itemId]),
        /** Only the person who used the command sees the reply. */
        ephemeral: z.boolean(),
        buttons: z.array(linkButtonSchema).max(5),
      })
      .strict()
      .refine((r) => r.text.trim() !== '' || r.embedId !== '', 'Add reply text or choose an embed'),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.type === 'slash') {
      const parsed = commandName.safeParse(c.name);
      if (!parsed.success) ctx.addIssue({ code: 'custom', path: ['name'], message: parsed.error.issues[0]!.message });
      if (!c.description) ctx.addIssue({ code: 'custom', path: ['description'], message: 'Slash commands need a description' });
      const names = c.options.map((o) => o.name);
      if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Option names must be different' });
      // Discord: required options must come before optional ones.
      const firstOptional = c.options.findIndex((o) => !o.required);
      if (firstOptional !== -1 && c.options.slice(firstOptional).some((o) => o.required)) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'Put required options before optional ones' });
      }
    } else if (c.options.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Right-click commands can’t have options' });
    }
  });
export type CustomCommand = z.infer<typeof customCommandSchema>;

export const COMMAND_VARIABLES = [
  { key: '{user}', description: 'Mentions whoever used the command' },
  { key: '{user.name}', description: 'Their display name' },
  { key: '{server}', description: 'Server name' },
  { key: '{channel}', description: 'Mentions the channel' },
  { key: '{target}', description: 'Right-click commands: the user or message author clicked on' },
  { key: '{option:NAME}', description: 'The value given for option NAME' },
] as const;

// ─── Automation workflows ─────────────────────────────────────────────────────────────────────────────────────────

export const WORKFLOW_LIMITS = { steps: 20, totalWaitSeconds: 3600, runsPerMinute: 30 } as const;

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30');

const trigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('memberJoin') }).strict(),
  z.object({ type: z.literal('memberLeave') }).strict(),
  z.object({ type: z.literal('messageContains'), keyword: z.string().trim().min(1).max(100), channelId: snowflakeSchema.nullable() }).strict(),
  z.object({ type: z.literal('roleAdded'), roleId: snowflakeSchema }).strict(),
  /** On chosen days (0 = Sunday; none = every day) at a time in a time zone. There is no member. */
  z.object({ type: z.literal('schedule'), time: clockTime, days: z.array(z.number().int().min(0).max(6)).max(7), timezone: z.string().trim().min(1).max(64) }).strict(),
  /** Someone reacts with this emoji (a unicode emoji, or a custom emoji's name or ID). */
  z.object({ type: z.literal('reactionAdded'), emoji: z.string().trim().min(1).max(64), channelId: snowflakeSchema.nullable() }).strict(),
  z.object({ type: z.literal('memberBoost') }).strict(),
  z.object({ type: z.literal('voiceJoin'), channelId: snowflakeSchema.nullable() }).strict(),
]);

/** A check used by "If … / Otherwise / End if" blocks. */
const condition = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hasRole'), roleId: snowflakeSchema, negate: z.boolean() }).strict(),
  z.object({ kind: z.literal('accountOlderThan'), days: z.number().int().min(0).max(3650) }).strict(),
  /** Compares text with variables filled in, e.g. {var:joins} greaterThan 100. Numbers compare as numbers. */
  z.object({ kind: z.literal('text'), text: z.string().max(200), op: z.enum(['equals', 'contains', 'greaterThan', 'lessThan']), value: z.string().max(200), negate: z.boolean() }).strict(),
]);
export type WorkflowCondition = z.infer<typeof condition>;
const varName = z.string().regex(/^[a-z0-9_]{1,32}$/, 'Variable names: 1–32 lowercase letters, numbers or _');

const step = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sendMessage'), channelId: snowflakeSchema, text: z.string().max(2000), embedId: z.union([z.literal(''), itemId]) }).strict(),
  z.object({ type: z.literal('reply'), text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('sendDM'), text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('addRole'), roleId: snowflakeSchema }).strict(),
  z.object({ type: z.literal('removeRole'), roleId: snowflakeSchema }).strict(),
  z.object({ type: z.literal('deleteMessage') }).strict(),
  z.object({ type: z.literal('wait'), seconds: z.number().int().min(1).max(3600) }).strict(),
  /** Conditions: the run stops here if the check fails. */
  z.object({ type: z.literal('ifHasRole'), roleId: snowflakeSchema, negate: z.boolean() }).strict(),
  z.object({ type: z.literal('ifAccountOlderThan'), days: z.number().int().min(0).max(3650) }).strict(),
  z.object({ type: z.literal('createThread'), name: z.string().trim().min(1).max(100) }).strict(),
  z.object({ type: z.literal('timeout'), minutes: z.number().int().min(1).max(40320) }).strict(),
  z.object({ type: z.literal('sendRandom'), channelId: snowflakeSchema, texts: z.array(z.string().trim().min(1).max(2000)).min(2, 'Add at least two messages').max(10) }).strict(),
  /** Saved per server and kept between runs; use it anywhere as {var:name}. "add" adds a number (e.g. a counter). */
  z.object({ type: z.literal('setVariable'), name: varName, mode: z.enum(['set', 'add']), value: z.string().max(200) }).strict(),
  /** Blocks: the steps after "If" run only when the check passes; "Otherwise" steps run when it doesn't. */
  z.object({ type: z.literal('if'), check: condition }).strict(),
  z.object({ type: z.literal('else') }).strict(),
  z.object({ type: z.literal('endIf') }).strict(),
]);
export type WorkflowStep = z.infer<typeof step>;
export type WorkflowTrigger = z.infer<typeof trigger>;

/** Which steps make sense for a trigger (message steps need a message, member steps need a member). */
export function stepAllowed(t: WorkflowTrigger['type'], s: WorkflowStep['type']): boolean {
  if (s === 'reply' || s === 'deleteMessage' || s === 'createThread') return t === 'messageContains' || t === 'reactionAdded';
  if (s === 'addRole' || s === 'removeRole' || s === 'ifHasRole' || s === 'timeout') return t !== 'memberLeave' && t !== 'schedule';
  if (s === 'sendDM' || s === 'ifAccountOlderThan') return t !== 'schedule';
  return true;
}

/** Same rule for the check inside an "If" block. */
export function conditionAllowed(t: WorkflowTrigger['type'], c: WorkflowCondition['kind']): boolean {
  if (c === 'hasRole') return stepAllowed(t, 'ifHasRole');
  if (c === 'accountOlderThan') return stepAllowed(t, 'ifAccountOlderThan');
  return true;
}

/** For each "If": where its "Otherwise" (or null) and "End if" are. Null if the blocks don't line up. */
export function workflowBlocks(steps: readonly Pick<WorkflowStep, 'type'>[]): Map<number, { else: number | null; end: number }> | null {
  const blocks = new Map<number, { else: number | null; end: number }>();
  const open: { at: number; else: number | null }[] = [];
  for (const [i, s] of steps.entries()) {
    if (s.type === 'if') {
      if (open.length >= 5) return null; // at most 5 levels deep
      open.push({ at: i, else: null });
    } else if (s.type === 'else') {
      const top = open[open.length - 1];
      if (!top || top.else !== null) return null;
      top.else = i;
    } else if (s.type === 'endIf') {
      const top = open.pop();
      if (!top) return null;
      blocks.set(top.at, { else: top.else, end: i });
    }
  }
  return open.length ? null : blocks;
}

export const workflowSchema = z
  .object({
    id: itemId,
    name: z.string().trim().min(1, 'Give the workflow a name').max(60),
    enabled: z.boolean(),
    guildId: snowflakeSchema,
    trigger,
    steps: z.array(step).min(1, 'Add at least one step').max(WORKFLOW_LIMITS.steps),
  })
  .strict()
  .superRefine((w, ctx) => {
    const waited = w.steps.reduce((n, s) => n + (s.type === 'wait' ? s.seconds : 0), 0);
    if (waited > WORKFLOW_LIMITS.totalWaitSeconds) ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Waits can add up to at most 1 hour per run' });
    w.steps.forEach((s, i) => {
      if (!stepAllowed(w.trigger.type, s.type)) ctx.addIssue({ code: 'custom', path: ['steps', i], message: `“${s.type}” can’t be used with this trigger` });
      if (s.type === 'if' && !conditionAllowed(w.trigger.type, s.check.kind)) ctx.addIssue({ code: 'custom', path: ['steps', i], message: 'That check needs a member, and this trigger has none' });
    });
    if (!workflowBlocks(w.steps)) ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Every “If” needs one “End if” (with at most one “Otherwise” between), up to 5 levels deep' });
  });
export type Workflow = z.infer<typeof workflowSchema>;

export interface WorkflowRun {
  id: number;
  workflowId: string;
  ok: boolean;
  /** Steps that ran before it finished or stopped. */
  steps: number;
  message: string;
  createdAt: string;
}

// ─── Everything a bot's builders hold ─────────────────────────────────────────────────────────────────────────────

export const buildersSchema = z
  .object({
    commands: z.array(customCommandSchema).max(100),
    embeds: z.array(embedSchema).max(100),
    workflows: z.array(workflowSchema).max(100),
  })
  .strict()
  .superRefine((b, ctx) => {
    for (const key of ['commands', 'embeds', 'workflows'] as const) {
      const ids = b[key].map((x) => x.id);
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: [key], message: 'IDs must be unique' });
    }
    const slash = b.commands.filter((c) => c.type === 'slash').map((c) => c.name);
    if (new Set(slash).size !== slash.length) ctx.addIssue({ code: 'custom', path: ['commands'], message: 'Two commands have the same name' });
    const embedIds = new Set(b.embeds.map((e) => e.id));
    b.commands.forEach((c, i) => {
      if (c.response.embedId && !embedIds.has(c.response.embedId)) ctx.addIssue({ code: 'custom', path: ['commands', i], message: `“${c.name}” uses an embed that was deleted` });
    });
  });
export type Builders = z.infer<typeof buildersSchema>;
export const EMPTY_BUILDERS: Builders = { commands: [], embeds: [], workflows: [] };

/** Unique short ID for a new builder item. */
export function newItemId(taken: readonly { id: string }[]): string {
  for (let n = taken.length + 1; ; n++) if (!taken.some((t) => t.id === `i${n}`)) return `i${n}`;
}

export const saveBuildersSchema = z.object({ id: z.uuid(), builders: z.unknown() }).strict();

/** Gateway intents enabled workflows need (members for join/leave/role triggers; message content for keywords). */
export function builderIntents(b: Pick<Builders, 'workflows'>, intentBits: Record<string, number>): number {
  let bits = 0;
  for (const w of b.workflows) {
    if (!w.enabled) continue;
    const t = w.trigger.type;
    if (t === 'messageContains') bits |= (intentBits['GuildMessages'] ?? 0) | (intentBits['MessageContent'] ?? 0);
    else if (t === 'reactionAdded') bits |= (intentBits['GuildMessageReactions'] ?? 0) | (intentBits['GuildMessages'] ?? 0);
    else if (t === 'voiceJoin') bits |= intentBits['GuildVoiceStates'] ?? 0;
    else if (t !== 'schedule') bits |= intentBits['GuildMembers'] ?? 0;
    // Member steps on reaction/voice triggers read the member list.
    if ((t === 'reactionAdded' || t === 'voiceJoin') && w.steps.some((s) => s.type === 'addRole' || s.type === 'removeRole' || s.type === 'timeout')) bits |= intentBits['GuildMembers'] ?? 0;
  }
  return bits;
}
