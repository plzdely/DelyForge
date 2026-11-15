/** Set at build time by electron.vite.config.ts (empty strings in development builds). */
declare const __DELYFORGE_API_URL__: string;
declare const __DELYFORGE_PUBLIC_KEY__: string;
declare const __DELYFORGE_UPDATE_URL__: string;

/** electron-vite copies `?asset` imports next to the build and gives their path. */
declare module '*?asset' {
  const path: string;
  export default path;
}
