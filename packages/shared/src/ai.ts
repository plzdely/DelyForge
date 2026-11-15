import { z } from 'zod';
import { type CustomCommand, type Workflow, customCommandSchema, workflowSchema } from './builders.js';
import { snowflakeSchema } from './discord.js';
import { DEFAULT_MODULE_CONFIGS, IMPLEMENTED_MODULES, type ImplementedModuleId, moduleConfigSchemas } from './modules.js';

/**
 * AI (Phase 6). The AI runs only on the DelyForge API (keys never ship in the app), is metered in credits, and never
 * changes anything by itself: it returns a proposal that is validated here, shown to the user, and applied only after
 * they approve it — through the same validated save paths as the normal settings screens.
 */

export const AI_FEATURES = { builder: 'ai.builder', troubleshoot: 'ai.troubleshooting' } as const;
export type AiFeature = keyof typeof AI_FEATURES;

/** One credit ≈ 2,000 input tokens; output tokens count 5×. Every request costs at least 1 credit. */
export function creditsFor(inputTokens: number, outputTokens: number): number {
  return Math.max(1, Math.ceil((inputTokens + outputTokens * 5) / 2000));
}

export interface AiUsageInfo {
  configured: boolean;
  used: number;
  limit: number;
  /** ISO date when the monthly allowance resets (first of next month, UTC). */
  resetsAt: string;
}

// ─── Requests (app → API) ─────────────────────────────────────────────────────────────────────────────────────────

/** Names and IDs only — the AI needs them to point settings at real channels and roles. No messages, no tokens. */
export const aiGuildContextSchema = z
  .object({
    id: snowflakeSchema,
    name: z.string().max(100),
    channels: z.array(z.object({ id: snowflakeSchema, name: z.string().max(100), kind: z.string().max(20) }).strict()).max(500),
    roles: z.array(z.object({ id: snowflakeSchema, name: z.string().max(100) }).strict()).max(250),
  })
  .strict();
export type AiGuildContext = z.infer<typeof aiGuildContextSchema>;

export const aiBuilderRequestSchema = z
  .object({ prompt: z.string().trim().min(10, 'Describe your bot in a sentence or two').max(2000), guild: aiGuildContextSchema })
  .strict();

export const aiTroubleshootRequestSchema = z
  .object({
    question: z.string().trim().max(1000),
    botName: z.string().max(80),
    status: z.string().max(40),
    lastError: z.string().max(1000).nullable(),
    /** Recent log lines, already passed through the secret redactor by the app. */
    logs: z.array(z.string().max(500)).max(200),
  })
  .strict();

// ─── What the model must answer (structured output) ───────────────────────────────────────────────────────────────

/**
 * Settings are returned as JSON text because each module has its own shape; they are parsed and checked against the
 * real schemas below, item by item, so one bad item never blocks the rest.
 */
export const aiBuilderOutputSchema = z.object({
  summary: z.string(),
  modules: z.array(z.object({ moduleId: z.enum(IMPLEMENTED_MODULES), settingsJson: z.string() })),
  commandsJson: z.array(z.string()),
  workflowsJson: z.array(z.string()),
  notes: z.array(z.string()),
});
export type AiBuilderOutput = z.infer<typeof aiBuilderOutputSchema>;

export const aiTroubleshootOutputSchema = z.object({
  summary: z.string(),
  likelyCause: z.string(),
  steps: z.array(z.string()),
});
export type AiTroubleshootAnswer = z.infer<typeof aiTroubleshootOutputSchema>;

// ─── Validated proposal (API → app) ───────────────────────────────────────────────────────────────────────────────

export type ProposedCommand = Omit<CustomCommand, 'id'>;
export type ProposedWorkflow = Omit<Workflow, 'id' | 'guildId'>;

export interface AiProposal {
  summary: string;
  modules: { moduleId: ImplementedModuleId; config: unknown }[];
  commands: ProposedCommand[];
  workflows: ProposedWorkflow[];
  notes: string[];
  /** Items the AI suggested that failed validation and were left out, with the reason. */
  dropped: string[];
}

export interface AiProposalResult {
  proposalId: string;
  proposal: AiProposal;
  creditsUsed: number;
  usage: AiUsageInfo;
}

export const aiProposalDecisionSchema = z.object({ decision: z.enum(['applied', 'rejected']) }).strict();

const PLACEHOLDER_ID = 'ai';

/** Objects are merged key by key; arrays and plain values from `patch` replace the defaults. */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every Discord-ID-looking string inside a value. */
function idsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && /^\d{17,20}$/.test(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => idsIn(v, out));
  else if (isPlainObject(value)) Object.values(value).forEach((v) => idsIn(v, out));
  return out;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return `${issue?.message ?? 'invalid'}${issue?.path.length ? ` (${issue.path.join('.')})` : ''}`;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Turns raw model output into a safe proposal: every item must pass the same schema the settings screens use, and
 * may only reference channels and roles that exist in the server (no invented IDs). Invalid items are dropped.
 */
export function validateProposal(raw: AiBuilderOutput, guild: AiGuildContext): AiProposal {
  const known = new Set([guild.id, ...guild.channels.map((c) => c.id), ...guild.roles.map((r) => r.id)]);
  const dropped: string[] = [];
  const unknownIds = (v: unknown) => idsIn(v).filter((id) => !known.has(id));

  const modules: AiProposal['modules'] = [];
  const seenModules = new Set<string>();
  for (const m of raw.modules) {
    if (seenModules.has(m.moduleId)) continue;
    const parsedJson = parseJson(m.settingsJson);
    if (!parsedJson.ok) {
      dropped.push(`${m.moduleId}: settings were not valid JSON`);
      continue;
    }
    const merged = deepMerge(DEFAULT_MODULE_CONFIGS[m.moduleId], parsedJson.value);
    const parsed = moduleConfigSchemas[m.moduleId].safeParse(merged);
    if (!parsed.success) {
      dropped.push(`${m.moduleId}: ${firstIssue(parsed.error)}`);
      continue;
    }
    const bad = unknownIds(parsed.data);
    if (bad.length) {
      dropped.push(`${m.moduleId}: refers to channels or roles that don’t exist in this server`);
      continue;
    }
    seenModules.add(m.moduleId);
    modules.push({ moduleId: m.moduleId, config: parsed.data });
  }

  const commands: ProposedCommand[] = [];
  for (const text of raw.commandsJson.slice(0, 10)) {
    const json = parseJson(text);
    // The AI can't create saved embeds, so any embed reference is cleared.
    const candidate = json.ok && isPlainObject(json.value)
      ? { ...json.value, id: PLACEHOLDER_ID, response: isPlainObject(json.value['response']) ? { ...json.value['response'], embedId: '' } : json.value['response'] }
      : null;
    const parsed = candidate ? customCommandSchema.safeParse(candidate) : null;
    if (!parsed?.success) {
      dropped.push(`command: ${parsed ? firstIssue(parsed.error) : 'not valid JSON'}`);
      continue;
    }
    if (commands.some((c) => c.type === parsed.data.type && c.name === parsed.data.name)) continue;
    const { id: _id, ...command } = parsed.data;
    commands.push(command);
  }

  const workflows: ProposedWorkflow[] = [];
  for (const text of raw.workflowsJson.slice(0, 10)) {
    const json = parseJson(text);
    const candidate = json.ok && isPlainObject(json.value)
      ? {
          ...json.value,
          id: PLACEHOLDER_ID,
          guildId: guild.id,
          steps: Array.isArray(json.value['steps']) ? json.value['steps'].map((s) => (isPlainObject(s) && s['type'] === 'sendMessage' ? { ...s, embedId: '' } : s)) : json.value['steps'],
        }
      : null;
    const parsed = candidate ? workflowSchema.safeParse(candidate) : null;
    if (!parsed?.success) {
      dropped.push(`workflow: ${parsed ? firstIssue(parsed.error) : 'not valid JSON'}`);
      continue;
    }
    if (unknownIds(parsed.data).length) {
      dropped.push(`workflow “${parsed.data.name}”: refers to channels or roles that don’t exist in this server`);
      continue;
    }
    const { id: _id, guildId: _g, ...workflow } = parsed.data;
    workflows.push(workflow);
  }

  return {
    summary: raw.summary.slice(0, 1000),
    modules,
    commands,
    workflows,
    notes: raw.notes.slice(0, 10).map((n) => n.slice(0, 300)),
    dropped,
  };
}
