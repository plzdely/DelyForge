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

const trigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('memberJoin') }).strict(),
  z.object({ type: z.literal('memberLeave') }).strict(),
  z.object({ type: z.literal('messageContains'), keyword: z.string().trim().min(1).max(100), channelId: snowflakeSchema.nullable() }).strict(),
  z.object({ type: z.literal('roleAdded'), roleId: snowflakeSchema }).strict(),
]);

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
]);
export type WorkflowStep = z.infer<typeof step>;
export type WorkflowTrigger = z.infer<typeof trigger>;

/** Which steps make sense for a trigger (message steps need a message, member steps need a member). */
export function stepAllowed(t: WorkflowTrigger['type'], s: WorkflowStep['type']): boolean {
  if (s === 'reply' || s === 'deleteMessage') return t === 'messageContains';
  if (s === 'addRole' || s === 'removeRole' || s === 'ifHasRole') return t !== 'memberLeave';
  return true;
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
    });
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
    if (w.trigger.type === 'messageContains') bits |= (intentBits['GuildMessages'] ?? 0) | (intentBits['MessageContent'] ?? 0);
    else bits |= intentBits['GuildMembers'] ?? 0;
  }
  return bits;
}
