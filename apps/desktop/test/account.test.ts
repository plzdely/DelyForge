import { generateKeyPairSync, sign } from 'node:crypto';
import { type EntitlementClaims, base64UrlEncode } from '@delyforge/shared';
import { describe, expect, it } from 'vitest';
import { AccountService, verifyCertificate } from '../src/main/account';
import { openDatabase } from '../src/main/db/database';
import type { Cipher } from '../src/main/db/secrets';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const cipher: Cipher = { isAvailable: () => true, encrypt: (s) => Buffer.from(`e:${s}`).reverse(), decrypt: (b) => Buffer.from(b).reverse().toString().slice(2) };

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-15T12:00:00Z');
const REFRESH = 'refresh-token-abcdefghijklmnopqrstuvwxyz';

function certificate(plan: 'free' | 'pro', iatMs: number, key = privateKey): string {
  const iat = Math.floor(iatMs / 1000);
  const claims: EntitlementClaims = {
    v: 1,
    sub: 'w1',
    uid: 'u1',
    subscribedPlanId: plan,
    effectivePlanId: plan,
    reason: plan === 'pro' ? 'active' : 'free_plan',
    status: 'active',
    features: plan === 'pro' ? ['ai.builder', 'modules.standard'] : ['modules.basic'],
    limits: { maxBotProjects: plan === 'pro' ? 5 : 1, maxWorkflows: plan === 'pro' ? null : 3, maxTeamMembers: 1, aiCreditsPerMonth: 300, logRetentionDays: 14 },
    graceEndsAt: null,
    iat,
    exp: iat + 86_400,
  };
  const payload = Buffer.from(JSON.stringify(claims));
  return `${base64UrlEncode(payload)}.${base64UrlEncode(sign(null, payload, key))}`;
}

/** A tiny fake of the DelyForge API. */
function fakeApi(opts: { plan: 'free' | 'pro'; now: () => number; online: () => boolean }) {
  const fetchImpl = (async (url: string) => {
    if (!opts.online()) throw new TypeError('fetch failed');
    const path = new URL(url).pathname;
    const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });
    const tokens = { accessToken: 'access', accessTokenExpiresAt: new Date(opts.now() + 900_000).toISOString(), refreshToken: REFRESH };
    if (path === '/v1/auth/login' || path === '/v1/auth/refresh') return json(200, tokens);
    if (path === '/v1/auth/logout') return json(204, null);
    if (path === '/v1/me') {
      return json(200, { id: 'u1', email: 'a@b.c', emailVerified: true, displayName: 'Dely', avatarUrl: null, role: 'USER', createdAt: '', workspace: { id: 'w1', name: 'W' } });
    }
    if (path === '/v1/entitlements') return json(200, { token: certificate(opts.plan, opts.now()), billingConfigured: true });
    return json(404, { error: { message: 'not found' } });
  }) as typeof fetch;
  return { fetchImpl };
}

function setup(plan: 'free' | 'pro' = 'pro') {
  let now = T0;
  let online = true;
  let changes = 0;
  const db = openDatabase(':memory:');
  const api = fakeApi({ plan, now: () => now, online: () => online });
  const service = new AccountService(db, cipher, {
    apiUrl: 'http://api.test',
    publicKeyPem: PUB,
    allowKeyDiscovery: false,
    onChange: () => changes++,
    fetchImpl: api.fetchImpl,
    now: () => now,
  });
  return { db, service, setNow: (t: number) => (now = t), setOnline: (v: boolean) => (online = v), changes: () => changes };
}

const login = (s: AccountService) => s.login({ email: 'a@b.c', password: 'long enough password' });

describe('plan certificates', () => {
  it('verifies the signature and rejects other keys or edited certificates', () => {
    expect(verifyCertificate(certificate('pro', T0), PUB)?.effectivePlanId).toBe('pro');
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(verifyCertificate(certificate('pro', T0, other), PUB)).toBeNull();
    const [payload, sig] = certificate('free', T0).split('.');
    const edited = base64UrlEncode(Buffer.from(Buffer.from(payload!, 'base64url').toString().replaceAll('"free"', '"pro"')));
    expect(verifyCertificate(`${edited}.${sig}`, PUB)).toBeNull();
    expect(verifyCertificate('garbage', PUB)).toBeNull();
  });
});

describe('AccountService', () => {
  it('is on Free until signed in, then uses the server-certified plan', async () => {
    const { service, changes } = setup('pro');
    expect(service.entitlements()).toMatchObject({ effectivePlanId: 'free', source: 'local' });
    const status = await login(service);
    expect(status).toMatchObject({ signedIn: true, plan: { effectivePlanId: 'pro' }, billingConfigured: true });
    expect(service.entitlements()).toMatchObject({ effectivePlanId: 'pro', source: 'account', limits: { maxBotProjects: 5 } });
    expect(changes()).toBeGreaterThan(0);
  });

  it('keeps the plan for up to 7 days offline, then falls back to Free', async () => {
    const { service, setNow, setOnline } = setup('pro');
    await login(service);
    setOnline(false);
    setNow(T0 + 3 * DAY);
    const status = await service.refreshPlan();
    expect(status.offline).toBe(true);
    expect(service.entitlements().effectivePlanId).toBe('pro');
    setNow(T0 + 8 * DAY);
    expect(service.entitlements().effectivePlanId).toBe('free');
    setOnline(true);
    await service.refreshPlan();
    expect(service.entitlements().effectivePlanId).toBe('pro');
  });

  it('signs out locally even when the server is unreachable', async () => {
    const { service, setOnline } = setup('pro');
    await login(service);
    setOnline(false);
    expect((await service.logout()).signedIn).toBe(false);
    expect(service.entitlements().effectivePlanId).toBe('free');
  });

  it('stores the refresh token encrypted, never in plain text', async () => {
    const { db, service } = setup('pro');
    await login(service);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'account.refreshToken'").get() as { value: string };
    expect(row.value).not.toContain(REFRESH);
  });
});
