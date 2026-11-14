/**
 * Entry point of a bot process. Started by the desktop supervisor with Electron's `utilityProcess.fork()`
 * (or Node's `child_process.fork()` in tests/cloud). It waits for a `start` message carrying the token —
 * the token is never passed on the command line or in environment variables.
 */
import type { FromRuntime } from '@delyforge/shared';
import { createDiscordClient } from './discord-client.js';
import { createBotRuntime } from './runtime.js';

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

const send = (message: FromRuntime) => {
  if (parentPort) parentPort.postMessage(message);
  else process.send?.(message);
};

const runtime = createBotRuntime({
  send,
  createClient: createDiscordClient,
  exit: (code) => setTimeout(() => process.exit(code), 50),
});

if (parentPort) parentPort.on('message', (e) => void runtime.handle(e.data));
else process.on('message', (m) => void runtime.handle(m));

process.on('uncaughtException', (err) => {
  runtime.log('error', `Unexpected error: ${err.message}`);
  process.exit(1); // the supervisor decides whether to restart
});
process.on('unhandledRejection', (err) => {
  runtime.log('error', `Unhandled error: ${(err as Error)?.message ?? String(err)}`);
});
