import { describe, expect, it } from 'vitest';
import {
  INTENT_BITS,
  PERMISSION_PRESETS,
  buildInviteUrl,
  checkTokenShape,
  fromRuntimeSchema,
  missingPrivilegedIntents,
  permissionsSchema,
  presenceSchema,
  privilegedIntentsFromFlags,
  tokenHint,
  toRuntimeSchema,
} from '../src/index.js';

// Clearly fake, correctly shaped values.
const FAKE_TOKEN = 'MTAxMjM0NTY3ODkwMTIzNDU2Nw.GaBcDe.' + 'abcdefghijklmnopqrstuvwxyz0123456789AB';

describe('checkTokenShape', () => {
  it('accepts a well-formed token and strips a "Bot " prefix and whitespace', () => {
    expect(checkTokenShape(`  Bot ${FAKE_TOKEN} `)).toEqual({ ok: true, token: FAKE_TOKEN });
  });

  it('recognises the values beginners paste by mistake', () => {
    const msg = (v: string) => {
      const r = checkTokenShape(v);
      return r.ok ? '' : r.message;
    };
    expect(msg('')).toMatch(/Paste/);
    expect(msg('123456789012345678')).toMatch(/Application ID/);
    expect(msg('a'.repeat(64))).toMatch(/Public Key/);
    expect(msg('AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toMatch(/Client Secret/);
    expect(msg('hello world')).toMatch(/spaces/);
    expect(msg('not-a-token')).toMatch(/doesn’t look like/);
  });

  it('builds a hint that reveals only the last 4 characters', () => {
    expect(tokenHint(FAKE_TOKEN)).toBe('…89AB');
  });
});

describe('intents', () => {
  it('reads privileged intent flags from the application', () => {
    expect(privilegedIntentsFromFlags(0)).toEqual({ GuildPresences: false, GuildMembers: false, MessageContent: false });
    expect(privilegedIntentsFromFlags((1 << 14) | (1 << 19))).toEqual({
      GuildPresences: false,
      GuildMembers: true,
      MessageContent: true,
    });
  });

  it('lists privileged intents the bot needs but the portal has not enabled', () => {
    const intents = INTENT_BITS['Guilds']! | INTENT_BITS['GuildMembers']! | INTENT_BITS['MessageContent']!;
    expect(missingPrivilegedIntents(intents, 1 << 14).map((i) => i.key)).toEqual(['MessageContent']);
    expect(missingPrivilegedIntents(INTENT_BITS['Guilds']!, 0)).toEqual([]);
  });
});

describe('permissions and invites', () => {
  it('builds a valid invite link with bot + slash command scopes', () => {
    const url = new URL(buildInviteUrl('123456789012345678', PERMISSION_PRESETS.basic.toString()));
    expect(url.origin).toBe('https://discord.com');
    expect(url.searchParams.get('client_id')).toBe('123456789012345678');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
    expect(BigInt(url.searchParams.get('permissions')!)).toBe(PERMISSION_PRESETS.basic);
  });

  it('presets never include Administrator', () => {
    for (const preset of Object.values(PERMISSION_PRESETS)) expect(preset & (1n << 3n)).toBe(0n);
  });

  it('validates 64-bit permission strings', () => {
    expect(permissionsSchema.safeParse(PERMISSION_PRESETS.full.toString()).success).toBe(true);
    expect(permissionsSchema.safeParse('-1').success).toBe(false);
    expect(permissionsSchema.safeParse('99999999999999999999').success).toBe(false);
  });
});

describe('presence & runtime protocol', () => {
  it('validates presence', () => {
    expect(presenceSchema.safeParse({ status: 'idle', activity: { type: 'watching', text: 'the server' } }).success).toBe(true);
    expect(presenceSchema.safeParse({ status: 'away', activity: null }).success).toBe(false);
    expect(presenceSchema.safeParse({ status: 'online', activity: { type: 'playing', text: '' } }).success).toBe(false);
  });

  it('rejects malformed runtime messages', () => {
    expect(fromRuntimeSchema.safeParse({ type: 'log', level: 'info', message: 'hi' }).success).toBe(true);
    expect(fromRuntimeSchema.safeParse({ type: 'log', level: 'shout', message: 'hi' }).success).toBe(false);
    expect(fromRuntimeSchema.safeParse({ type: 'run-code', code: 'x' }).success).toBe(false);
    expect(
      toRuntimeSchema.safeParse({
        type: 'start',
        token: FAKE_TOKEN,
        options: { intents: 1, presence: { status: 'online', activity: null }, builtinPing: true },
      }).success,
    ).toBe(true);
  });
});
