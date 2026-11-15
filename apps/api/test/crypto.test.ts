import { verify } from 'node:crypto';
import { base64UrlDecode, entitlementClaimsSchema } from '@delyforge/shared';
import { describe, expect, it } from 'vitest';
import { hashPassword, loadEntitlementKeys, signAccessToken, signEntitlements, verifyAccessToken, verifyPassword } from '../src/auth/crypto';

describe('passwords', () => {
  it('hashes with a random salt and verifies only the right password', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
    expect(a).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery staple', a)).toBe(true);
    expect(await verifyPassword('wrong password', a)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });
});

describe('access tokens', () => {
  const secret = 's'.repeat(40);
  it('round-trips and rejects tampering, a wrong secret and expiry', () => {
    const { token } = signAccessToken({ sub: 'u1', sid: 's1', ws: 'w1' }, secret, 900, 1_000_000);
    expect(verifyAccessToken(token, secret, 1_000_000)).toMatchObject({ sub: 'u1', sid: 's1', ws: 'w1' });
    const [h, , sig] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'admin', sid: 's1', ws: 'w1', iat: 1, exp: 9e9 })).toString('base64url')}.${sig}`;
    expect(verifyAccessToken(forged, secret, 1_000_000)).toBeNull();
    expect(verifyAccessToken(token, 'x'.repeat(40), 1_000_000)).toBeNull();
    expect(verifyAccessToken(token, secret, 1_000_000 + 901_000)).toBeNull();
    expect(verifyAccessToken('garbage', secret)).toBeNull();
  });
});

describe('entitlement certificates', () => {
  it('are signed with Ed25519 and verifiable with only the public key', () => {
    const keys = loadEntitlementKeys(undefined);
    const claims = entitlementClaimsSchema.parse({
      v: 1,
      sub: 'w1',
      uid: 'u1',
      subscribedPlanId: 'pro',
      effectivePlanId: 'pro',
      reason: 'active',
      status: 'active',
      features: ['ai.builder'],
      limits: { maxBotProjects: 5, maxWorkflows: null, maxTeamMembers: 1, aiCreditsPerMonth: 300, logRetentionDays: 14 },
      graceEndsAt: null,
      iat: 1,
      exp: 2,
    });
    const token = signEntitlements(claims, keys.privateKey);
    const [payload, sig] = token.split('.') as [string, string];
    const ok = verify(null, Buffer.from(base64UrlDecode(payload)), keys.publicKeyPem, Buffer.from(base64UrlDecode(sig)));
    expect(ok).toBe(true);
    // Upgrading yourself by editing the payload breaks the signature.
    const tampered = Buffer.from(JSON.stringify({ ...claims, effectivePlanId: 'enterprise' }));
    expect(verify(null, tampered, keys.publicKeyPem, Buffer.from(base64UrlDecode(sig)))).toBe(false);
  });
});
