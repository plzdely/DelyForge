import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    // Bundle everything (including @delyforge/shared, zod and the bot runtime with discord.js) so the installed app needs
    // no node_modules; only Electron, Node built-ins and discord.js's optional native speed-ups stay external.
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          'bot-runtime': resolve(import.meta.dirname, '../../packages/bot-runtime/dist/process.js'),
        },
        external: ['electron', /^node:/, 'zlib-sync', 'bufferutil', 'utf-8-validate', 'erlpack'],
      },
    },
    // Release builds bake in the production API and the plan/package signing key (see scripts/release.mjs).
    define: {
      __DELYFORGE_API_URL__: JSON.stringify(process.env['DELYFORGE_API_URL'] ?? ''),
      __DELYFORGE_PUBLIC_KEY__: JSON.stringify(process.env['DELYFORGE_ENTITLEMENT_PUBLIC_KEY'] ?? ''),
      __DELYFORGE_UPDATE_URL__: JSON.stringify(process.env['DELYFORGE_UPDATE_URL'] ?? ''),
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ['electron'],
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    resolve: {
      alias: { '@': resolve(import.meta.dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') },
    },
  },
});
