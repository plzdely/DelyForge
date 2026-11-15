import { z } from 'zod';

export const themeSchema = z.enum(['dark', 'light', 'system']);
export type Theme = z.infer<typeof themeSchema>;

export const appSettingsSchema = z.object({
  theme: themeSchema,
  reduceMotion: z.boolean(),
  /** Shows sidebar entries for features that are planned but not yet built, each with an honest roadmap page. */
  showRoadmapPreview: z.boolean(),
  /** Closing the window hides DelyForge in the tray so bots keep running (Quit is in the tray menu). */
  runInBackground: z.boolean(),
  /** Start DelyForge (hidden in the tray) when Windows starts — installed app only. */
  startWithWindows: z.boolean(),
  notifications: z
    .object({
      crashes: z.boolean(),
      disconnects: z.boolean(),
      restarts: z.boolean(),
      highMemory: z.boolean(),
      /** Also show a Windows notification (in addition to the in-app inbox). */
      desktop: z.boolean(),
    })
    .strict(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  reduceMotion: false,
  showRoadmapPreview: false,
  runInBackground: true,
  startWithWindows: false,
  notifications: { crashes: true, disconnects: true, restarts: true, highMemory: true, desktop: true },
};

/** Partial update — at least one known key, unknown keys rejected. */
export const appSettingsPatchSchema = appSettingsSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Empty settings update' });
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;
