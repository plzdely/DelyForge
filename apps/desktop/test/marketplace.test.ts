import { generateKeyPairSync, sign } from 'node:crypto';
import { base64UrlEncode, packageSigningInput } from '@delyforge/shared';
import { describe, expect, it } from 'vitest';
import { verifyPackage } from '../src/main/marketplace';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const COMMAND = { id: 'i1', enabled: true, type: 'slash', name: 'rules', description: 'Rules', options: [], access: 'everyone', cooldownSeconds: 0, response: { text: 'Be nice', embedId: '', ephemeral: false, buttons: [] } };

const signed = (content: unknown, key = privateKey) => {
  const payload = JSON.stringify({ slug: 'rules', title: 'Rules', version: '1.0.0', content });
  return { payload, signature: base64UrlEncode(sign(null, Buffer.from(packageSigningInput(payload)), key)) };
};
const ok = { modules: {}, commands: [COMMAND], embeds: [], workflows: [] };

describe('verifyPackage', () => {
  it('accepts a pack signed by DelyForge', () => {
    expect(verifyPackage(signed(ok), PUB)?.content.commands[0]?.name).toBe('rules');
  });

  it('refuses edited packs, other keys and signed packs that fail validation', () => {
    const pkg = signed(ok);
    expect(verifyPackage({ ...pkg, payload: pkg.payload.replace('Be nice', 'Be mean') }, PUB)).toBeNull();
    expect(verifyPackage(signed(ok, generateKeyPairSync('ed25519').privateKey), PUB)).toBeNull();
    expect(verifyPackage(signed({ ...ok, commands: [{ ...COMMAND, name: 'Bad Name' }] }), PUB)).toBeNull();
    expect(verifyPackage({ payload: '{', signature: 'x' }, PUB)).toBeNull();
  });
});
