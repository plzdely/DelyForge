import {
  type KeyObject,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scrypt,
  sign,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { type EntitlementClaims, base64UrlDecode, base64UrlEncode } from '@delyforge/shared';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/** scrypt parameters (OWASP: N=2^17 with r=8,p=1 ≈ 128 MiB; we use 2^15 ≈ 32 MiB to stay fast on small servers). */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** Hash a password. Never store or log the plain text. Format: scrypt$N$r$p$salt$hash (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, base64UrlEncode(salt), base64UrlEncode(hash)].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(base64UrlDecode(hash));
  const actual = await scryptAsync(password.normalize('NFKC'), Buffer.from(base64UrlDecode(salt)), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A dummy hash used when an email isn't registered, so login takes the same time either way. */
export const DUMMY_HASH_PROMISE = hashPassword(randomBytes(16).toString('hex'));

export const randomToken = (bytes = 32) => base64UrlEncode(randomBytes(bytes));
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// ─── Access tokens (JWT, HS256) ───────────────────────────────────────────────────────────────────────────────────

export interface AccessClaims {
  sub: string; // user id
  sid: string; // session id
  ws: string; // workspace id
  iat: number;
  exp: number;
}

const enc = (o: unknown) => base64UrlEncode(Buffer.from(JSON.stringify(o)));
const JWT_HEADER = enc({ alg: 'HS256', typ: 'JWT' });

export function signAccessToken(claims: Omit<AccessClaims, 'iat' | 'exp'>, secret: string, ttlSeconds = 900, now = Date.now()): { token: string; expiresAt: Date } {
  const iat = Math.floor(now / 1000);
  const body = enc({ ...claims, iat, exp: iat + ttlSeconds });
  const sig = base64UrlEncode(createHmac('sha256', secret).update(`${JWT_HEADER}.${body}`).digest());
  return { token: `${JWT_HEADER}.${body}.${sig}`, expiresAt: new Date((iat + ttlSeconds) * 1000) };
}

/** Returns the claims, or null if the token is malformed, tampered with or expired. */
export function verifyAccessToken(token: string, secret: string, now = Date.now()): AccessClaims | null {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig || header !== JWT_HEADER) return null;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(base64UrlDecode(sig));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(base64UrlDecode(body)).toString()) as AccessClaims;
    return claims.exp * 1000 > now ? claims : null;
  } catch {
    return null;
  }
}

// ─── Entitlement tokens (Ed25519) ─────────────────────────────────────────────────────────────────────────────────

export interface EntitlementKeys {
  privateKey: KeyObject;
  /** PEM (SPKI) public key, given to desktop builds so they can verify tokens. */
  publicKeyPem: string;
  ephemeral: boolean;
}

/** Loads the signing key from ENTITLEMENT_PRIVATE_KEY (base64 of a PKCS#8 PEM), or makes a temporary one for development. */
export function loadEntitlementKeys(base64Pem: string | undefined): EntitlementKeys {
  if (base64Pem) {
    const privateKey = createPrivateKey(Buffer.from(base64Pem, 'base64').toString('utf8'));
    return { privateKey, publicKeyPem: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString(), ephemeral: false };
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), ephemeral: true };
}

/** `<payload>.<signature>`, both base64url. */
export function signEntitlements(claims: EntitlementClaims, key: KeyObject): string {
  const payload = Buffer.from(JSON.stringify(claims));
  return `${base64UrlEncode(payload)}.${base64UrlEncode(sign(null, payload, key))}`;
}
