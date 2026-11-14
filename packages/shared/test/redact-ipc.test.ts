import { describe, expect, it } from 'vitest';
import {
  IPC_CHANNELS,
  REDACTED,
  createRedactor,
  ipcInputSchemas,
  isAllowedExternalUrl,
  redactSecrets,
} from '../src/index.js';

// Clearly fake values shaped like real secrets.
const FAKE_DISCORD_TOKEN = 'MTAxMjM0NTY3ODkwMTIzNDU2Nw.GaBcDe.' + 'abcdefghijklmnopqrstuvwxyz0123456789AB';

describe('redactSecrets', () => {
  it('redacts Discord bot tokens', () => {
    const out = redactSecrets(`login failed for token ${FAKE_DISCORD_TOKEN} (401)`);
    expect(out).not.toContain(FAKE_DISCORD_TOKEN);
    expect(out).toContain(REDACTED);
  });

  it('redacts authorization headers, Stripe keys and webhook URLs', () => {
    const text = [
      'Authorization: Bot abcdefghijklmnopqrstuvwxyz123456',
      'key=sk_test_FAKEFAKEFAKE1234567890',
      'secret=whsec_FAKEFAKEFAKE12345',
      'hook https://discord.com/api/webhooks/123456789/AbCdEf-ghIJ_kl',
    ].join('\n');
    const out = redactSecrets(text);
    expect(out).not.toMatch(/sk_test_|whsec_|abcdefghijklmnopqrstuvwxyz123456|AbCdEf-ghIJ_kl/);
  });

  it('leaves ordinary text alone', () => {
    const text = 'Bot "Helper" connected to 3 guilds in 120ms.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('redacts registered runtime secrets', () => {
    const redact = createRedactor();
    redact.addSecret('my-custom-secret-value');
    expect(redact('value is my-custom-secret-value!')).toBe(`value is ${REDACTED}!`);
    redact.addSecret('short');
    expect(redact('short words stay')).toBe('short words stay');
  });
});

describe('IPC contract', () => {
  it('only allows https URLs on the allow-list', () => {
    expect(isAllowedExternalUrl('https://discord.com/developers/applications')).toBe(true);
    expect(isAllowedExternalUrl('http://discord.com')).toBe(false);
    expect(isAllowedExternalUrl('https://discord.com.evil.example')).toBe(false);
    expect(isAllowedExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
  });

  it('validates settings updates strictly', () => {
    const schema = ipcInputSchemas[IPC_CHANNELS.settingsUpdate];
    expect(schema.safeParse({ theme: 'light' }).success).toBe(true);
    expect(schema.safeParse({ theme: 'neon' }).success).toBe(false);
    expect(schema.safeParse({ unknownKey: true }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('rejects payloads on channels that take no input', () => {
    expect(ipcInputSchemas[IPC_CHANNELS.appGetInfo].safeParse(undefined).success).toBe(true);
    expect(ipcInputSchemas[IPC_CHANNELS.appGetInfo].safeParse({ evil: 1 }).success).toBe(false);
  });
});
