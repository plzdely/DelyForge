import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBotProjectSchema, resolveEntitlements } from '@delyforge/shared';
import { BotRepository } from '../src/main/db/bots';
import { openDatabase } from '../src/main/db/database';
import { LogRepository, NotificationRepository } from '../src/main/db/logs';
import { ActivityRepository } from '../src/main/db/repositories';
import { type Cipher, SecretRepository } from '../src/main/db/secrets';
import { DiscordApi } from '../src/main/discord-api';
import { AppError } from '../src/main/errors';
import { BotConnections } from '../src/main/runtime/connections';

const GOOD = 'MTAxMjM0NTY3ODkwMTIzNDU2Nw.GaBcDe.' + 'abcdefghijklmnopqrstuvwxyz0123456789AB';
const OTHER = 'MTAxMjM0NTY3ODkwMTIzNDU2OA.GaBcDe.' + 'abcdefghijklmnopqrstuvwxyz0123456789XY';
const REVOKED = 'MTAxMjM0NTY3ODkwMTIzNDU2OQ.GaBcDe.' + 'abcdefghijklmnopqrstuvwxyz0123456789ZZ';

const fakeCipher: Cipher = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
};

/** A tiny stand-in for the Discord REST API. */
let server: Server;
let base = '';
const seenUserAgents: string[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    seenUserAgents.push(String(req.headers['user-agent']));
    const auth = req.headers.authorization ?? '';
    const token = auth.replace(/^Bot /, '');
    if (token === REVOKED || !auth.startsWith('Bot ')) {
      res.writeHead(401).end(JSON.stringify({ message: '401: Unauthorized' }));
      return;
    }
    const appId = token === GOOD ? '111111111111111111' : '222222222222222222';
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/users/@me') res.end(JSON.stringify({ id: appId, username: 'Aurora', avatar: 'abc', bot: true }));
    else if (req.url === '/applications/@me') res.end(JSON.stringify({ id: appId, name: 'Aurora App', flags: 1 << 19 }));
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function setup() {
  const db = openDatabase(':memory:');
  const activity = new ActivityRepository(db);
  const bots = new BotRepository(db, activity, () => resolveEntitlements({ planId: 'pro', status: 'active' }));
  const secrets = new SecretRepository(db, fakeCipher);
  const connections = new BotConnections(bots, secrets, new DiscordApi('0.3.0', base), activity);
  const add = (name: string) => bots.create(createBotProjectSchema.parse({ name })).id;
  return { db, bots, secrets, connections, add };
}

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error('expected an error');
}

describe('connecting a bot to Discord', () => {
  it('verifies the token, stores it encrypted and records the bot identity', async () => {
    const { db, bots, secrets, connections, add } = setup();
    const id = add('Aurora');
    const project = await connections.connect(id, `  ${GOOD}  `);

    expect(project).toMatchObject({
      hasToken: true,
      tokenHint: '…89AB',
      discordApplicationId: '111111111111111111',
      botUsername: 'Aurora',
      privilegedIntents: { MessageContent: true, GuildMembers: false, GuildPresences: false },
    });
    expect(project.botAvatarUrl).toContain('cdn.discordapp.com/avatars/111111111111111111/abc');
    // The database never contains the token in plain text…
    const raw = db.prepare('SELECT encrypted_token FROM bot_secrets').get() as { encrypted_token: Uint8Array };
    expect(Buffer.from(raw.encrypted_token).toString()).not.toContain(GOOD);
    // …but the main process can read it back for its runtime.
    expect(secrets.get(id)).toBe(GOOD);
    expect(bots.list()[0]).not.toHaveProperty('token');
    expect(seenUserAgents.at(-1)).toMatch(/^DiscordBot \(DelyForge, 0\.3\.0\)$/);
  });

  it('explains common paste mistakes without contacting Discord', async () => {
    const { connections, add } = setup();
    const before = seenUserAgents.length;
    const err = await errorOf(connections.connect(add('A'), 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.message).toMatch(/Client Secret/);
    expect(seenUserAgents.length).toBe(before);
  });

  it('reports a token Discord rejects', async () => {
    const { connections, secrets, add } = setup();
    const id = add('A');
    const err = await errorOf(connections.connect(id, REVOKED));
    expect(err.code).toBe('DISCORD_REJECTED');
    expect(secrets.get(id)).toBeNull();
  });

  it('reports network problems clearly', async () => {
    const { bots, secrets, add } = setup();
    const offline = new BotConnections(bots, secrets, new DiscordApi('0.3.0', 'http://127.0.0.1:1'), new ActivityRepository(openDatabase(':memory:')));
    const err = await errorOf(offline.connect(add('A'), GOOD));
    expect(err.code).toBe('NETWORK');
  });

  it('refuses to connect the same Discord bot to two projects', async () => {
    const { connections, add } = setup();
    await connections.connect(add('A'), GOOD);
    const err = await errorOf(connections.connect(add('B'), GOOD));
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toContain('“A”');
    // A different bot is fine.
    await expect(connections.connect(add('C'), OTHER)).resolves.toMatchObject({ hasToken: true });
  });

  it('disconnecting deletes the token and the Discord details', async () => {
    const { connections, secrets, add } = setup();
    const id = add('A');
    await connections.connect(id, GOOD);
    const p = connections.disconnect(id);
    expect(p).toMatchObject({ hasToken: false, tokenHint: null, discordApplicationId: null, botUsername: null });
    expect(secrets.get(id)).toBeNull();
  });

  it('refuses to store a token when secure storage is unavailable', () => {
    const db = openDatabase(':memory:');
    const secrets = new SecretRepository(db, { ...fakeCipher, isAvailable: () => false });
    expect(() => secrets.save('x', GOOD, '1')).toThrow(/Secure storage/);
  });
});

describe('logs & notifications', () => {
  it('keeps logs in order, clears them and exports text', () => {
    const { add, db } = setup();
    const id = add('A');
    const logs = new LogRepository(db);
    logs.append(id, 'info', 'one');
    logs.append(id, 'error', 'two');
    expect(logs.list(id).map((l) => l.message)).toEqual(['one', 'two']);
    expect(logs.list(id, 1).map((l) => l.message)).toEqual(['two']);
    expect(logs.toText(id)).toMatch(/\[INFO\] one\n.*\[ERROR\] two\n$/);
    logs.clear(id);
    expect(logs.list(id)).toEqual([]);
  });

  it('prunes logs older than the retention period', () => {
    const { add, db } = setup();
    const id = add('A');
    const logs = new LogRepository(db);
    logs.append(id, 'info', 'new');
    db.prepare("INSERT INTO bot_logs (bot_id, level, message, created_at) VALUES (?, 'info', 'old', '2020-01-01T00:00:00.000Z')").run(id);
    expect(logs.pruneOlderThan(3)).toBe(1);
    expect(logs.list(id).map((l) => l.message)).toEqual(['new']);
  });

  it('tracks unread notifications', () => {
    const { db } = setup();
    const n = new NotificationRepository(db);
    const a = n.create('bot.crashed', 'Bot crashed', 'x', null);
    n.create('bot.restarted', 'Bot restarted', 'y', null);
    expect(n.unreadCount()).toBe(2);
    n.markRead([a.id]);
    expect(n.unreadCount()).toBe(1);
    n.markRead();
    expect(n.unreadCount()).toBe(0);
    n.clear();
    expect(n.list()).toEqual([]);
  });
});
