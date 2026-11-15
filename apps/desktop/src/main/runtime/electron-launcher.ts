import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { utilityProcess } from 'electron';
import type { Launcher, RuntimeProcess } from './supervisor';

/** The bot runtime is bundled next to the main process (electron.vite.config.ts), in development and when installed. */
export function resolveRuntimeEntry(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'bot-runtime.js');
}

/**
 * Launches each bot in its own Electron utility process: a plain Node.js process with no access to the app's windows.
 * A fixed entry file is used — no shell, and nothing from user input is placed on the command line (SECURITY.md S4).
 */
export function createElectronLauncher(entry: string): Launcher {
  return (botName: string): RuntimeProcess => {
    const child = utilityProcess.fork(entry, [], {
      serviceName: `DelyForge bot — ${botName.replace(/[^\w .-]/g, '').slice(0, 40)}`,
      stdio: 'pipe',
    });
    return {
      get pid() {
        return child.pid;
      },
      postMessage: (m) => child.postMessage(m),
      onMessage: (listener) => child.on('message', listener),
      onExit: (listener) => child.on('exit', (code) => listener(code)),
      onOutput: (listener) => {
        child.stdout?.on('data', (d: Buffer) => listener(d.toString('utf8'), 'stdout'));
        child.stderr?.on('data', (d: Buffer) => listener(d.toString('utf8'), 'stderr'));
      },
      kill: () => {
        child.kill();
      },
    };
  };
}
