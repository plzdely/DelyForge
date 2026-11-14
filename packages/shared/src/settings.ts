import { z } from 'zod';

export const themeSchema = z.enum(['dark', 'light', 'system']);
export type Theme = z.infer<typeof themeSchema>;

export const appSettingsSchema = z.object({
  theme: themeSchema,
  reduceMotion: z.boolean(),
  /** Shows sidebar entries for features that are planned but not yet built, each with an honest roadmap page. */
  showRoadmapPreview: z.boolean(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  reduceMotion: false,
  showRoadmapPreview: false,
};

/** Partial update — at least one known key, unknown keys rejected. */
export const appSettingsPatchSchema = appSettingsSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Empty settings update' });
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;
