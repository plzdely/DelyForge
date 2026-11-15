import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated once at startup.
 * The API refuses to start with missing or invalid configuration rather than failing later at runtime.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), 'DATABASE_URL must be a PostgreSQL URL'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /** Max database connections. The local `prisma dev` database needs 1 (it mixes up parallel connections). */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).optional(),
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  /** Signs access tokens. At least 32 random characters — `pnpm --filter @delyforge/api keys:generate` makes one. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** Base64 of a PKCS#8 PEM Ed25519 private key that signs plan certificates. Optional in development. */
  ENTITLEMENT_PRIVATE_KEY: z.string().optional().default(''),
  /** Public address of this API, used in email links. */
  PUBLIC_API_URL: z.url().default('http://localhost:4000'),
  /** Where Stripe Checkout returns to (a page that tells the user to go back to DelyForge). */
  BILLING_RETURN_URL: z.url().optional(),
  /** Anthropic API key for the AI features. Without it the AI routes answer "not set up" instead of failing. */
  ANTHROPIC_API_KEY: z.string().optional().default(''),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (!env.ENTITLEMENT_PRIVATE_KEY) ctx.addIssue({ code: 'custom', path: ['ENTITLEMENT_PRIVATE_KEY'], message: 'required in production' });
  if (env.JWT_SECRET.includes('dev-only')) ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'replace the development value in production' });
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Only print which variables are wrong — never their values (they may be secrets).
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid API configuration:\n${problems}\nSee apps/api/.env.example`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
