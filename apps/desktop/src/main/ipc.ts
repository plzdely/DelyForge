import { type IpcMainInvokeEvent, ipcMain } from 'electron';
import { type IpcChannel, type IpcResult, ipcInputSchemas } from '@delyforge/shared';
import type { z } from 'zod';
import { AppError } from './errors';
import type { Logger } from './logger';

type Input<C extends IpcChannel> = z.output<(typeof ipcInputSchemas)[C]>;

export interface IpcContext {
  logger: Logger;
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
}

/**
 * Registers an IPC handler that:
 *  1. rejects calls from any frame that is not our own app UI,
 *  2. validates the payload against the shared Zod schema,
 *  3. wraps the result in the `IpcResult` envelope and never leaks internal error details.
 */
export function createIpcRegistrar(ctx: IpcContext) {
  return function handle<C extends IpcChannel, T>(
    channel: C,
    fn: (input: Input<C>, event: IpcMainInvokeEvent) => T | Promise<T>,
  ): void {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<T>> => {
      if (!ctx.isTrustedSender(event)) {
        ctx.logger.warn('Rejected IPC call from untrusted sender', { channel, url: event.senderFrame?.url });
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender' } };
      }

      const parsed = ipcInputSchemas[channel].safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: { code: 'VALIDATION_FAILED', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        };
      }

      try {
        return { ok: true, data: await fn(parsed.data as Input<C>, event) };
      } catch (err) {
        if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } };
        ctx.logger.error(`IPC handler failed: ${channel}`, err);
        return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Details were written to the log.' } };
      }
    });
  };
}
