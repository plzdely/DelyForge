import { z } from 'zod';
import type { PlanId } from './plans.js';

/** Account requests shared by the API (validation) and the desktop app (forms). */

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email({ message: 'Enter a valid email address' })).pipe(z.string().max(254));

/** At least 10 characters; long passphrases are encouraged over symbol rules. */
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200, 'Use at most 200 characters');

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1, 'Enter your name').max(50),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Enter your password').max(200),
    deviceName: z.string().trim().max(80).optional(),
  })
  .strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }).strict();
export const updateProfileSchema = z.object({ displayName: z.string().trim().min(1).max(50) }).strict();
export const checkoutSchema = z.object({ planId: z.enum(['pro', 'business']), interval: z.enum(['month', 'year']) }).strict();

export interface AuthTokens {
  accessToken: string;
  /** Short-lived access token expiry (ISO). */
  accessTokenExpiresAt: string;
  refreshToken: string;
}

export interface AccountProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
  role: 'USER' | 'SUPPORT' | 'ADMIN';
  createdAt: string;
  workspace: { id: string; name: string };
}

export interface SessionInfo {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface InvoiceInfo {
  id: string;
  number: string | null;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string;
  hostedUrl: string | null;
}

// ─── Signed entitlement token ─────────────────────────────────────────────────────────────────────────────────────

/**
 * What the server certifies a workspace may use. Signed by the API (Ed25519) and verified by the desktop app with the
 * matching public key, so a customer can't simply edit it. Valid for 24 h; the app keeps using a verified copy for up
 * to 7 days offline (ARCHITECTURE.md §8).
 */
export const entitlementClaimsSchema = z
  .object({
    v: z.literal(1),
    /** Workspace ID. */
    sub: z.string(),
    /** User the token was issued to. */
    uid: z.string(),
    subscribedPlanId: z.enum(['free', 'pro', 'business', 'enterprise']),
    effectivePlanId: z.enum(['free', 'pro', 'business', 'enterprise']),
    reason: z.string(),
    status: z.string(),
    features: z.array(z.string()),
    limits: z
      .object({
        maxBotProjects: z.number().nullable(),
        maxWorkflows: z.number().nullable(),
        maxTeamMembers: z.number().nullable(),
        aiCreditsPerMonth: z.number(),
        logRetentionDays: z.number(),
      })
      .strict(),
    graceEndsAt: z.string().nullable(),
    /** Issued-at and expiry, seconds since epoch. */
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();
export type EntitlementClaims = z.infer<typeof entitlementClaimsSchema>;

export const OFFLINE_GRACE_DAYS = 7;

export interface AccountStatus {
  signedIn: boolean;
  profile: AccountProfile | null;
  /** The plan certified by the server (null when signed out). */
  plan: { subscribedPlanId: PlanId; effectivePlanId: PlanId; reason: string; graceEndsAt: string | null } | null;
  /** When the plan certificate was last refreshed from the server. */
  verifiedAt: string | null;
  /** True when the API couldn't be reached and the cached certificate is being used. */
  offline: boolean;
  billingConfigured: boolean;
}

/** Base64url helpers that work in Node and browsers. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
