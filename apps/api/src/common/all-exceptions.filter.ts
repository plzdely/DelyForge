import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { redactSecrets } from '@delyforge/shared';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

/**
 * Every error leaves the API in the same shape: `{ error: { code, message, requestId } }`.
 * Unexpected errors are logged (redacted) with the request ID and the client only sees a generic message —
 * internal details and stack traces never leak.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof ZodError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      message = 'Request validation failed';
      details = exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message?.toString() ?? exception.message);
    } else {
      const err = exception as Error;
      this.logger.error(
        `[${requestId}] ${req.method} ${req.url} → ${redactSecrets(err?.message ?? String(exception))}`,
        err?.stack ? redactSecrets(err.stack) : undefined,
      );
    }

    const body: ApiErrorBody = {
      error: {
        code: STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'ERROR'),
        message,
        requestId,
        ...(details ? { details } : {}),
      },
    };
    res.status(status).json(body);
  }
}
