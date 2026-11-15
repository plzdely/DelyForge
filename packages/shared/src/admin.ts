import { z } from 'zod';
import { FEATURE_KEYS, type PlanId } from './plans.js';

/**
 * Internal admin dashboard (Phase 9), for DelyForge staff only. Support staff can look; admins can change things.
 * Every change is written to the audit log.
 */

export interface AdminOverview {
  users: number;
  newUsers7d: number;
  subscriptions: Record<PlanId, number>;
  aiCreditsThisMonth: number;
  /** Our AI provider cost this month, in US cents. */
  aiCostCentsThisMonth: number;
  pendingReviews: number;
  publishedListings: number;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: 'USER' | 'SUPPORT' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  emailVerified: boolean;
  createdAt: string;
  discord: { id: string; username: string } | null;
  workspace: { id: string; name: string; planId: string; subscriptionStatus: string | null };
  overrides: { id: string; grantFeatures: string[]; limits: Record<string, number | null>; reason: string; expiresAt: string | null }[];
}

export interface AdminAuditEntry {
  id: string;
  action: string;
  actor: string | null;
  workspaceId: string | null;
  metadata: unknown;
  createdAt: string;
}

/** SUSPENDED is a ban: the account is signed out everywhere and its email and Discord account can't be used again. */
export const adminUserStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().min(3).max(300) }).strict();

export const adminOverrideSchema = z
  .object({
    grantFeatures: z.array(z.enum(FEATURE_KEYS)).max(FEATURE_KEYS.length),
    limits: z
      .object({
        maxBotProjects: z.number().int().min(0).nullable(),
        maxWorkflows: z.number().int().min(0).nullable(),
        maxTeamMembers: z.number().int().min(1).nullable(),
        aiCreditsPerMonth: z.number().int().min(0),
        logRetentionDays: z.number().int().min(1).max(365),
      })
      .partial()
      .strict(),
    reason: z.string().trim().min(3).max(300),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict();

export const adminRoleSchema = z.object({ role: z.enum(['USER', 'SUPPORT', 'ADMIN']) }).strict();

export const adminListingStatusSchema = z.object({ status: z.enum(['PUBLISHED', 'SUSPENDED']), reason: z.string().trim().min(3).max(300) }).strict();
export const adminReviewHiddenSchema = z.object({ hidden: z.boolean() }).strict();
