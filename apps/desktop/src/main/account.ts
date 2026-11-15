import { createPublicKey, verify } from 'node:crypto';
import {
  type AccountEntitlements,
  type AccountProfile,
  type AccountStatus,
  type AuthTokens,
  type EntitlementClaims,
  type InvoiceInfo,
  OFFLINE_GRACE_DAYS,
  base64UrlDecode,
  entitlementClaimsSchema,
  isPlanId,
  resolveEntitlements,
} from '@delyforge/shared';
import type { LocalDatabase } from './db/database';
import type { Cipher } from './db/secrets';
import { AppError } from './errors';

const FREE: AccountEntitlements = { ...resolveEntitlements({ planId: 'free', status: 'none' }), graceEndsAt: null, source: 'local' };
const DAY = 86_400_000;

interface Stored {
  refreshToken: string | null;
  certificate: string | null;
  verifiedAt: string | null;
  profile: AccountProfile | null;
}

/** Verifies a plan certificate's Ed25519 signature; returns its claims or null. */
export function verifyCertificate(token: string, publicKeyPem: string): EntitlementClaims | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const bytes = Buffer.from(base64UrlDecode(payload));
    if (!verify(null, bytes, createPublicKey(publicKeyPem), Buffer.from(base64UrlDecode(sig)))) return null;
    const parsed = entitlementClaimsSchema.safeParse(JSON.parse(bytes.toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The signed-in account, as seen by the desktop app.
 *
 * - The refresh token is kept encrypted with the OS keystore; the short-lived access token only in memory.
 * - What the customer may use comes from the server-signed plan certificate. A verified certificate keeps working for
 *   up to 7 days without internet (so a flaky connection never stops bots); after that the app falls back to Free.
 */
export class AccountService {
  private access: { token: string; expiresAt: number } | null = null;
  private offline = false;
  private billingConfigured = false;
  private publicKeyPem: string | null;

  constructor(
    private readonly db: LocalDatabase,
    private readonly cipher: Cipher,
    private readonly opts: {
      apiUrl: string;
      /** PEM public key that signs certificates. Production builds embed it. */
      publicKeyPem: string | null;
      /** Development only: may fetch the key from the API on first use. */
      allowKeyDiscovery: boolean;
      /** Customer builds: nothing works until signed in with Discord linked (so bans can't be dodged). */
      requireAccount?: boolean;
      onChange: () => void;
      fetchImpl?: typeof fetch;
      now?: () => number;
    },
  ) {
    this.publicKeyPem = opts.publicKeyPem;
  }

  private get now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  // ─── Local storage (settings table, secrets encrypted) ───────────────────────────────────────────────────────────

  private read(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(`account.${key}`) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as string | null) : null;
  }

  private write(key: string, value: string | null): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(`account.${key}`, JSON.stringify(value));
  }

  private stored(): Stored {
    const enc = this.read('refreshToken');
    let refreshToken: string | null = null;
    if (enc) {
      try {
        refreshToken = this.cipher.decrypt(Buffer.from(enc, 'base64'));
      } catch {
        refreshToken = null; // saved under another Windows account — treat as signed out
      }
    }
    const profile = this.read('profile');
    return { refreshToken, certificate: this.read('certificate'), verifiedAt: this.read('verifiedAt'), profile: profile ? (JSON.parse(profile) as AccountProfile) : null };
  }

  private saveTokens(t: AuthTokens): void {
    if (!this.cipher.isAvailable()) throw new AppError('INTERNAL', 'Secure storage is not available, so DelyForge can’t keep you signed in.');
    this.write('refreshToken', this.cipher.encrypt(t.refreshToken).toString('base64'));
    this.access = { token: t.accessToken, expiresAt: Date.parse(t.accessTokenExpiresAt) };
  }

  private clear(): void {
    for (const k of ['refreshToken', 'certificate', 'verifiedAt', 'profile']) this.write(k, null);
    this.access = null;
  }

  // ─── HTTP ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async http<T>(method: string, path: string, body?: unknown, auth = false, timeoutMs = 15_000): Promise<T> {
    const doFetch = async (token?: string) => {
      try {
        return await (this.opts.fetchImpl ?? fetch)(`${this.opts.apiUrl}${path}`, {
          method,
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        this.offline = true;
        throw new AppError('NETWORK', 'Couldn’t reach DelyForge’s servers. Check your internet connection and try again.');
      }
    };
    let res = await doFetch(auth ? await this.accessToken() : undefined);
    if (res.status === 401 && auth) {
      this.access = null; // maybe expired — try once more with a fresh token
      res = await doFetch(await this.accessToken());
    }
    this.offline = false;
    if (res.status === 204) return null as T;
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } } & T;
    if (!res.ok) {
      const message = json.error?.message ?? `Request failed (${res.status})`;
      if (res.status === 401 && auth) {
        this.clear();
        this.opts.onChange();
      }
      const code = res.status === 401 || res.status === 403 ? 'FORBIDDEN' : res.status === 422 ? 'VALIDATION_FAILED' : res.status === 409 ? 'CONFLICT' : res.status === 429 ? 'LIMIT_REACHED' : 'INTERNAL';
      throw new AppError(code, message);
    }
    return json;
  }

  private async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt - 30_000 > this.now) return this.access.token;
    const { refreshToken } = this.stored();
    if (!refreshToken) throw new AppError('FORBIDDEN', 'Please sign in.');
    const tokens = await this.http<AuthTokens>('POST', '/v1/auth/refresh', { refreshToken });
    this.saveTokens(tokens);
    return tokens.accessToken;
  }

  // ─── Plan certificate ────────────────────────────────────────────────────────────────────────────────────────────

  private async ensurePublicKey(): Promise<string> {
    if (this.publicKeyPem) return this.publicKeyPem;
    if (!this.opts.allowKeyDiscovery) throw new AppError('INTERNAL', 'This build has no plan-certificate key configured.');
    const { publicKey } = await this.http<{ publicKey: string }>('GET', '/v1/entitlements/public-key');
    this.publicKeyPem = publicKey;
    return publicKey;
  }

  /** Fetches and verifies a fresh plan certificate. */
  async refreshPlan(): Promise<AccountStatus> {
    if (!this.stored().refreshToken) return this.status();
    try {
      const profile = await this.http<AccountProfile>('GET', '/v1/me', undefined, true);
      this.write('profile', JSON.stringify(profile));
      const res = await this.http<{ token: string; billingConfigured: boolean }>('GET', '/v1/entitlements', undefined, true);
      const claims = verifyCertificate(res.token, await this.ensurePublicKey());
      if (!claims) throw new AppError('INTERNAL', 'The plan certificate from the server could not be verified.');
      this.billingConfigured = res.billingConfigured;
      this.write('certificate', res.token);
      this.write('verifiedAt', new Date(this.now).toISOString());
    } catch (e) {
      if ((e as AppError).code !== 'NETWORK') throw e; // offline: keep the cached certificate
    }
    this.opts.onChange();
    return this.status();
  }

  /** The verified certificate, while current or within the 7-day offline grace window; otherwise null. */
  private validClaims(): EntitlementClaims | null {
    const s = this.stored();
    if (!s.refreshToken || !s.certificate || !s.verifiedAt || !this.publicKeyPem) return null;
    const claims = verifyCertificate(s.certificate, this.publicKeyPem);
    if (!claims) return null;
    const fresh = claims.exp * 1000 > this.now || this.now - Date.parse(s.verifiedAt) < OFFLINE_GRACE_DAYS * DAY;
    return fresh && isPlanId(claims.effectivePlanId) ? claims : null;
  }

  /** Whether this installation may be used at all (customer builds need an account with Discord linked). */
  accessState(): AccountStatus['access'] {
    if (!this.opts.requireAccount) return { allowed: true, needs: null };
    const claims = this.validClaims();
    if (!claims) return { allowed: false, needs: 'sign-in' };
    if (claims.discordOk === false) return { allowed: false, needs: 'discord' };
    return { allowed: true, needs: null };
  }

  /** Starts linking Discord: the Discord page to open in the browser. */
  async discordLinkUrl(): Promise<string> {
    return (await this.http<{ url: string }>('POST', '/v1/me/discord', undefined, true)).url;
  }

  /** What this installation may use right now. */
  entitlements(): AccountEntitlements {
    const claims = this.validClaims();
    if (!claims) return FREE;
    return {
      subscribedPlanId: claims.subscribedPlanId,
      effectivePlanId: claims.effectivePlanId,
      reason: claims.reason as AccountEntitlements['reason'],
      limits: claims.limits,
      features: claims.features as AccountEntitlements['features'],
      graceEndsAt: claims.graceEndsAt,
      source: 'account',
    };
  }

  status(): AccountStatus {
    const s = this.stored();
    const ent = this.entitlements();
    const signedIn = Boolean(s.refreshToken);
    return {
      signedIn,
      profile: signedIn ? s.profile : null,
      plan: signedIn ? { subscribedPlanId: ent.subscribedPlanId, effectivePlanId: ent.effectivePlanId, reason: ent.reason, graceEndsAt: ent.graceEndsAt } : null,
      verifiedAt: signedIn ? s.verifiedAt : null,
      offline: this.offline,
      billingConfigured: this.billingConfigured,
      access: this.accessState(),
    };
  }

  // ─── Account actions ─────────────────────────────────────────────────────────────────────────────────────────────

  async register(input: { email: string; password: string; displayName: string }): Promise<AccountStatus> {
    this.saveTokens(await this.http<AuthTokens>('POST', '/v1/auth/register', input));
    return this.refreshPlan();
  }

  async login(input: { email: string; password: string; deviceName?: string }): Promise<AccountStatus> {
    this.saveTokens(await this.http<AuthTokens>('POST', '/v1/auth/login', { ...input, deviceName: input.deviceName ?? 'DelyForge Desktop' }));
    return this.refreshPlan();
  }

  async logout(): Promise<AccountStatus> {
    try {
      if (this.stored().refreshToken) await this.http('POST', '/v1/auth/logout', undefined, true);
    } catch {
      // Sign out locally even if the server can't be reached.
    }
    this.clear();
    this.opts.onChange();
    return this.status();
  }

  async forgotPassword(email: string): Promise<void> {
    await this.http('POST', '/v1/auth/forgot-password', { email });
  }

  async resendVerification(): Promise<void> {
    await this.http('POST', '/v1/auth/resend-verification', undefined, true);
  }

  async updateProfile(displayName: string): Promise<AccountStatus> {
    const profile = await this.http<AccountProfile>('PATCH', '/v1/me', { displayName }, true);
    this.write('profile', JSON.stringify(profile));
    this.opts.onChange();
    return this.status();
  }

  async checkoutUrl(planId: 'pro' | 'business', interval: 'month' | 'year'): Promise<string> {
    return (await this.http<{ url: string }>('POST', '/v1/billing/checkout', { planId, interval }, true)).url;
  }

  async portalUrl(): Promise<string> {
    return (await this.http<{ url: string }>('POST', '/v1/billing/portal', undefined, true)).url;
  }

  /** Makes another workspace active on this computer (its plan applies from now on). */
  async switchWorkspace(workspaceId: string): Promise<AccountStatus> {
    this.saveTokens(await this.http<AuthTokens>('POST', '/v1/team/switch', { workspaceId }, true));
    return this.refreshPlan();
  }

  /** DelyForge's signing key (embedded in release builds); verifies plan certificates and marketplace packages. */
  publicKey(): Promise<string> {
    return this.ensurePublicKey();
  }

  /** A call that needs no account (public marketplace browsing). */
  publicGet<T>(path: string): Promise<T> {
    return this.http<T>('GET', path);
  }

  /** A signed-in call to the DelyForge API (used by the AI assistant; AI answers can take a minute or two). */
  authed<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    return this.http<T>(method, path, body, true, timeoutMs);
  }

  async invoices(): Promise<InvoiceInfo[]> {
    return this.http<InvoiceInfo[]>('GET', '/v1/billing/invoices', undefined, true);
  }
}
