import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRedactor } from '@delyforge/shared';

type Level = 'debug' | 'info' | 'warn' | 'error';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Main-process logger: writes JSON lines to `<userData>/logs/main.log`, rotating at 5 MB.
 * Every message passes through the secret redactor first (SECURITY.md S2).
 */
export class Logger {
  readonly redact = createRedactor();
  private readonly file: string;

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'main.log');
  }

  debug(msg: string, meta?: unknown): void {
    this.write('debug', msg, meta);
  }
  info(msg: string, meta?: unknown): void {
    this.write('info', msg, meta);
  }
  warn(msg: string, meta?: unknown): void {
    this.write('warn', msg, meta);
  }
  error(msg: string, meta?: unknown): void {
    this.write('error', msg, meta);
  }

  private write(level: Level, msg: string, meta?: unknown): void {
    const line = this.redact(
      JSON.stringify({ t: new Date().toISOString(), level, msg, ...(meta !== undefined ? { meta: serialize(meta) } : {}) }),
    );
    if (process.env['NODE_ENV'] !== 'production' || level === 'error') {
      // eslint-disable-next-line no-console
      (level === 'error' ? console.error : console.log)(line);
    }
    try {
      this.rotateIfNeeded();
      appendFileSync(this.file, line + '\n');
    } catch {
      // Logging must never crash the app.
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (statSync(this.file).size > MAX_BYTES) renameSync(this.file, join(this.dir, 'main.1.log'));
    } catch {
      // File does not exist yet.
    }
  }
}

function serialize(meta: unknown): unknown {
  if (meta instanceof Error) return { name: meta.name, message: meta.message, stack: meta.stack };
  return meta;
}
