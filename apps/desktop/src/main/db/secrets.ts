import { tokenHint } from '@delyforge/shared';
import { AppError } from '../errors';
import type { LocalDatabase } from './database';

/** OS-backed encryption. In the app this is Electron `safeStorage` (Windows DPAPI / macOS Keychain). */
export interface Cipher {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

/**
 * Bot tokens, encrypted at rest and readable only by the same Windows user on the same machine.
 * Tokens never leave the main process except over the private channel to that bot's own runtime process.
 */
export class SecretRepository {
  constructor(
    private readonly db: LocalDatabase,
    private readonly cipher: Cipher,
  ) {}

  save(botId: string, token: string, applicationId: string): void {
    if (!this.cipher.isAvailable()) {
      // Refuse rather than fall back to storing the token in plain text.
      throw new AppError('INTERNAL', 'Secure storage is not available on this computer, so the token cannot be saved safely.');
    }
    const encrypted = this.cipher.encrypt(token);
    this.db
      .prepare(
        `INSERT INTO bot_secrets (bot_id, encrypted_token, token_hint, application_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(bot_id) DO UPDATE SET encrypted_token = excluded.encrypted_token, token_hint = excluded.token_hint,
           application_id = excluded.application_id, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(botId, encrypted, tokenHint(token), applicationId);
  }

  /** Returns the decrypted token, or null when none is stored. */
  get(botId: string): string | null {
    const row = this.db.prepare('SELECT encrypted_token FROM bot_secrets WHERE bot_id = ?').get(botId) as
      | { encrypted_token: Uint8Array }
      | undefined;
    if (!row) return null;
    try {
      return this.cipher.decrypt(Buffer.from(row.encrypted_token));
    } catch {
      throw new AppError(
        'INTERNAL',
        'The stored token could not be decrypted (it may have been saved under a different Windows account). Reconnect the bot.',
      );
    }
  }

  remove(botId: string): void {
    this.db.prepare('DELETE FROM bot_secrets WHERE bot_id = ?').run(botId);
  }
}
