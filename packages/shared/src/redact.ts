/**
 * Secret redaction. Every log line that could contain user-provided or third-party data MUST pass through a redactor
 * before it is stored, displayed, or sent anywhere (SECURITY.md S2).
 */

export const REDACTED = '[REDACTED]';

const PATTERNS: readonly RegExp[] = [
  // Discord bot tokens: base64(user id) . timestamp . HMAC
  /\b[A-Za-z\d_-]{23,28}\.[A-Za-z\d_-]{6,7}\.[A-Za-z\d_-]{27,}\b/g,
  // Authorization headers
  /\b(Bot|Bearer)\s+[A-Za-z\d._~+/=-]{20,}/g,
  // Stripe secret / restricted / webhook keys
  /\b(sk|rk)_(live|test)_[A-Za-z\d]{10,}\b/g,
  /\bwhsec_[A-Za-z\d]{10,}\b/g,
  // Common AI provider keys
  /\bsk-(ant-|proj-)?[A-Za-z\d_-]{20,}\b/g,
  // Discord webhook URLs (contain a secret token)
  /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z\d_-]+/g,
];

export interface Redactor {
  (text: string): string;
  /** Register an exact secret value (e.g. a token loaded at runtime) so it is always redacted. */
  addSecret(secret: string): void;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createRedactor(initialSecrets: readonly string[] = []): Redactor {
  const secrets = new Set<string>();

  const redact = ((text: string): string => {
    let out = text;
    for (const secret of secrets) {
      out = out.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
    }
    for (const pattern of PATTERNS) {
      out = out.replace(pattern, REDACTED);
    }
    return out;
  }) as Redactor;

  redact.addSecret = (secret: string) => {
    // Very short values would redact ordinary words; real secrets are long.
    if (secret.length >= 8) secrets.add(secret);
  };

  for (const s of initialSecrets) redact.addSecret(s);
  return redact;
}

/** Stateless redaction using the built-in patterns only. */
export const redactSecrets: (text: string) => string = createRedactor();
