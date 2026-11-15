// Generates production secrets for the API. Prints them — paste them into your server's environment (never commit them).
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
console.log('# ── API environment (keep secret) ──');
console.log(`JWT_SECRET=${randomBytes(48).toString('base64url')}`);
console.log(`ENTITLEMENT_PRIVATE_KEY=${Buffer.from(pem).toString('base64')}`);
console.log('\n# ── Desktop build: plan-certificate public key (safe to share) ──');
console.log(`DELYFORGE_ENTITLEMENT_PUBLIC_KEY=${Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }).toString()).toString('base64')}`);
