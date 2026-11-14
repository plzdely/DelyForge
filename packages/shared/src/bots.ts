import { z } from 'zod';

/** Limits chosen to match what Discord itself allows for application names/descriptions. */
export const BOT_LIMITS = {
  nameMax: 32,
  descriptionMax: 400,
  groupMax: 32,
  /** Largest import file accepted (bytes). */
  importMaxBytes: 1024 * 1024,
} as const;

export const botIdSchema = z.uuid({ message: 'Invalid bot id' });

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Give your bot a name')
  .max(BOT_LIMITS.nameMax, `Names can be at most ${BOT_LIMITS.nameMax} characters`);

const descriptionSchema = z
  .string()
  .trim()
  .max(BOT_LIMITS.descriptionMax, `Descriptions can be at most ${BOT_LIMITS.descriptionMax} characters`);

/** Empty string → no group. */
const groupSchema = z
  .string()
  .trim()
  .max(BOT_LIMITS.groupMax, `Group names can be at most ${BOT_LIMITS.groupMax} characters`)
  .transform((v) => (v === '' ? null : v))
  .nullable();

/** A bot project as shown in the UI. Never contains the token — only whether one is stored. */
export interface BotProject {
  id: string;
  name: string;
  description: string;
  groupName: string | null;
  discordApplicationId: string | null;
  isFavorite: boolean;
  isEnabled: boolean;
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
}

export const createBotProjectSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.default(''),
    groupName: groupSchema.default(null),
  })
  .strict();
export type CreateBotProjectInput = z.input<typeof createBotProjectSchema>;

export const updateBotProjectSchema = z
  .object({
    id: botIdSchema,
    patch: z
      .object({
        name: nameSchema,
        description: descriptionSchema,
        groupName: groupSchema,
        isFavorite: z.boolean(),
      })
      .partial()
      .strict()
      .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to update' }),
  })
  .strict();
export type UpdateBotProjectInput = z.input<typeof updateBotProjectSchema>;

export const botIdInputSchema = z.object({ id: botIdSchema }).strict();

// ─── Export / import ─────────────────────────────────────────────────────────────────────────────────────────────

export const BOT_EXPORT_FORMAT = 'delyforge.bot-project';
export const BOT_EXPORT_VERSION = 1;

/**
 * Portable project file. Strict: unknown fields are rejected, so a file can never smuggle in a token or other data the
 * app does not expect. Tokens are never exported (SECURITY.md S1/S16).
 */
export const botProjectExportSchema = z
  .object({
    format: z.literal(BOT_EXPORT_FORMAT),
    version: z.literal(BOT_EXPORT_VERSION),
    exportedAt: z.iso.datetime(),
    appVersion: z.string().max(40),
    project: z
      .object({
        name: nameSchema,
        description: descriptionSchema,
        groupName: groupSchema,
        /** Module / command / workflow configuration (validated per-module from Phase 4). */
        config: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();
export type BotProjectExport = z.infer<typeof botProjectExportSchema>;

export interface ExportResult {
  /** False when the user cancelled the save dialog. */
  saved: boolean;
  fileName: string | null;
}

export interface ImportResult {
  /** Null when the user cancelled the open dialog. */
  project: BotProject | null;
}

/** "My Bot" → "my-bot" for file names. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'bot'
  );
}
