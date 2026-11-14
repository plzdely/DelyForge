import type { IpcErrorCode } from '@delyforge/shared';

/** Throw from main-process code to return a specific, user-safe error message to the UI. */
export class AppError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
