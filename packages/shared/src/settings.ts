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
      /** The bot lost permissions one of its modules needs. (Defaults keep older saved settings valid.) */
      permissions: z.boolean().default(true),
      /** Also show a Windows notification (in addition to the in-app inbox). */
      desktop: z.boolean(),
      /** The bot also DMs its owner on Discord about crashes and lost permissions. */
      discordDm: z.boolean().default(true),
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
  notifications: { crashes: true, disconnects: true, restarts: true, highMemory: true, permissions: true, desktop: true, discordDm: true },
};

/** Partial update — at least one known key, unknown keys rejected. */
export const appSettingsPatchSchema = appSettingsSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Empty settings update' });
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;
