import { z } from 'zod';
import { discordIdsIn } from './ai.js';
import { type CustomCommand, type EmbedTemplate, type Workflow, customCommandSchema, embedSchema, workflowSchema } from './builders.js';
import { IMPLEMENTED_MODULES, type ModuleConfigs, moduleConfigSchemas } from './modules.js';

/**
 * Marketplace (Phase 8). Listings are declarative content packs — module settings, commands, embeds and workflows —
 * checked by the same schemas as the settings screens. Nothing in a pack is code. DelyForge reviews each version and
 * signs it; the app installs only packs whose signature verifies.
 */

export const LISTING_TYPES = ['TEMPLATE', 'COMMAND_PACK', 'EMBED_PACK', 'WORKFLOW_PACK'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];
export const LISTING_TYPE_NAMES: Record<ListingType, string> = {
  TEMPLATE: 'Template',
  COMMAND_PACK: 'Command pack',
  EMBED_PACK: 'Embed pack',
  WORKFLOW_PACK: 'Workflow pack',
};

/** Stand-in server ID while checking workflows (they get the buyer's server when installed). */
const PLACEHOLDER_GUILD = '10000000000000000';

const moduleSettings = z
  .object(Object.fromEntries(IMPLEMENTED_MODULES.map((id) => [id, moduleConfigSchemas[id].optional()])) as { [K in keyof typeof moduleConfigSchemas]: z.ZodOptional<(typeof moduleConfigSchemas)[K]> })
  .strict();

export const packageContentSchema = z
  .object({
    modules: moduleSettings,
    commands: z.array(customCommandSchema).max(25),
    embeds: z.array(embedSchema).max(25),
    /** Workflows without `guildId`; checked in `validatePackage`. */
    workflows: z.array(z.record(z.string(), z.unknown())).max(10),
  })
  .strict();

export interface PackageContent {
  modules: Partial<ModuleConfigs>;
  commands: CustomCommand[];
  embeds: EmbedTemplate[];
  workflows: Omit<Workflow, 'guildId'>[];
}

/** Checks a pack fully. Packs must not contain Discord IDs: every buyer picks their own channels and roles. */
export function validatePackage(raw: unknown): { ok: true; content: PackageContent } | { ok: false; error: string } {
  const parsed = packageContentSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: `${i?.message ?? 'Invalid package'}${i?.path.length ? ` (${i.path.join('.')})` : ''}` };
  }
  const { modules, commands, embeds } = parsed.data;
  const workflows: Omit<Workflow, 'guildId'>[] = [];
  for (const [n, w] of parsed.data.workflows.entries()) {
    const r = workflowSchema.safeParse({ ...w, guildId: PLACEHOLDER_GUILD });
    if (!r.success) return { ok: false, error: `Workflow ${n + 1}: ${r.error.issues[0]?.message ?? 'invalid'}` };
    const { guildId: _g, ...rest } = r.data;
    workflows.push(rest);
  }
  if (!Object.keys(modules).length && !commands.length && !embeds.length && !workflows.length) return { ok: false, error: 'The package is empty.' };
  if (discordIdsIn([modules, commands, embeds, workflows]).length) {
    return { ok: false, error: 'Packages can’t contain channel, role or server IDs — buyers choose their own after installing.' };
  }
  const embedIds = new Set(embeds.map((e) => e.id));
  const missing = [...commands.map((c) => c.response.embedId), ...workflows.flatMap((w) => w.steps.map((s) => (s.type === 'sendMessage' ? s.embedId : '')))]
    .filter((id) => id && !embedIds.has(id));
  if (missing.length) return { ok: false, error: 'A command uses an embed that isn’t in the package.' };
  return { ok: true, content: { modules: modules as Partial<ModuleConfigs>, commands, embeds, workflows } };
}

export const developerProfileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(40),
    slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, 'Use 3–32 lowercase letters, numbers and dashes'),
  })
  .strict();

export const submitListingSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, 'Use 3–48 lowercase letters, numbers and dashes'),
    type: z.enum(LISTING_TYPES),
    title: z.string().trim().min(3).max(60),
    summary: z.string().trim().min(10).max(160),
    description: z.string().trim().max(4000),
    category: z.string().trim().min(2).max(30),
    tags: z.array(z.string().trim().min(1).max(20)).max(5),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use a version like 1.0.0'),
    changelog: z.string().trim().max(1000),
    content: z.unknown(),
  })
  .strict();

export const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().max(1000) }).strict();
export const moderateVersionSchema = z.object({ approve: z.boolean(), notes: z.string().trim().max(1000) }).strict();

export interface ListingSummary {
  slug: string;
  type: ListingType;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  developer: string;
  ratingAvg: number;
  ratingCount: number;
  downloads: number;
  version: string;
  updatedAt: string;
}

export interface ListingDetail extends ListingSummary {
  description: string;
  changelog: string | null;
  contents: { modules: string[]; commands: string[]; embeds: number; workflows: string[] };
  reviews: { id: string; rating: number; body: string | null; author: string; createdAt: string }[];
}

export interface MyListing {
  slug: string;
  title: string;
  status: 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'SUSPENDED';
  versions: { version: string; reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED'; reviewNotes: string | null; createdAt: string }[];
}

export interface ReviewQueueItem {
  versionId: string;
  slug: string;
  title: string;
  type: ListingType;
  version: string;
  developer: string;
  submittedAt: string;
  content: PackageContent;
}

/** What the API hands out on install: the pack as signed JSON text. */
export interface SignedPackage {
  payload: string;
  signature: string;
}

export interface PackagePayload {
  slug: string;
  title: string;
  version: string;
  content: PackageContent;
}

/** Signed bytes are prefixed so a package signature can never be mistaken for a plan certificate. */
export const packageSigningInput = (payload: string): string => `delyforge-package:v1\n${payload}`;
