import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  type EntitlementClaims,
  type EntitlementOverrides,
  type FeatureKey,
  type InvoiceInfo,
  type PlanDefinition,
  type PlanId,
  type SubscriptionStatus,
  isPlanId,
  resolveEntitlements,
} from '@delyforge/shared';
import Stripe from 'stripe';
import { type EntitlementKeys, signEntitlements } from '../auth/crypto';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export const ENTITLEMENT_KEYS = Symbol('ENTITLEMENT_KEYS');
const TOKEN_TTL_SECONDS = 24 * 3600;

const STATUS: Record<string, SubscriptionStatus> = {
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  UNPAID: 'unpaid',
  CANCELED: 'canceled',
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
  PAUSED: 'paused',
};

/**
 * Subscriptions and entitlements. Stripe is the source of truth for payments; its signed webhooks keep our copy in
 * sync. What a customer may use is decided here on the server and handed to apps as a signed, short-lived certificate.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe | null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(ENTITLEMENT_KEYS) private readonly keys: EntitlementKeys,
  ) {
    this.stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
    if (keys.ephemeral) this.logger.warn('Using a temporary plan-certificate key (set ENTITLEMENT_PRIVATE_KEY to keep certificates valid across restarts).');
  }

  get configured(): boolean {
    return this.stripe !== null && Boolean(this.env.STRIPE_WEBHOOK_SECRET);
  }

  publicKey(): string {
    return this.keys.publicKeyPem;
  }

  // ─── Entitlements ────────────────────────────────────────────────────────────────────────────────────────────────

  private async catalogue(): Promise<Record<PlanId, PlanDefinition>> {
    const plans = await this.prisma.plan.findMany();
    const out = {} as Record<PlanId, PlanDefinition>;
    for (const p of plans) {
      if (!isPlanId(p.id)) continue;
      out[p.id] = {
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        rank: p.rank,
        pricing: null,
        limits: p.limits as unknown as PlanDefinition['limits'],
        features: p.features as unknown as FeatureKey[],
        highlights: p.highlights as unknown as string[],
      };
    }
    return out;
  }

  /** The signed plan certificate for a user's workspace, plus the decoded claims for display. */
  async entitlements(userId: string, workspaceId: string, now = new Date()): Promise<{ token: string; claims: EntitlementClaims }> {
    const [sub, overrides, catalogue, user] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { workspaceId } }),
      this.prisma.entitlementOverride.findMany({ where: { workspaceId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      this.catalogue(),
      this.prisma.user.findUnique({ where: { id: userId }, select: { discordId: true } }),
    ]);
    // Discord linking is mandatory once the server has it set up; the app refuses to run without it (signed claim).
    const discordOk = !(this.env.DISCORD_CLIENT_ID && this.env.DISCORD_CLIENT_SECRET) || Boolean(user?.discordId);
    const merged: EntitlementOverrides = {
      grantFeatures: overrides.flatMap((o) => o.grantFeatures as unknown as FeatureKey[]),
      limits: Object.assign({}, ...overrides.map((o) => o.limits as object)),
    };
    const planId = sub && isPlanId(sub.planId) ? sub.planId : 'free';
    const status = sub ? (STATUS[sub.status] ?? 'none') : 'none';
    const resolved = resolveEntitlements({
      planId,
      status,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      overrides: merged,
      now,
      ...(Object.keys(catalogue).length === 4 ? { catalogue } : {}),
    });
    const iat = Math.floor(now.getTime() / 1000);
    const claims: EntitlementClaims = {
      v: 1,
      sub: workspaceId,
      uid: userId,
      subscribedPlanId: resolved.subscribedPlanId,
      effectivePlanId: resolved.effectivePlanId,
      reason: resolved.reason,
      status,
      features: resolved.features,
      limits: resolved.limits,
      graceEndsAt: resolved.graceEndsAt?.toISOString() ?? null,
      discordOk,
      iat,
      exp: iat + TOKEN_TTL_SECONDS,
    };
    return { token: signEntitlements(claims, this.keys.privateKey), claims };
  }

  // ─── Checkout, portal, invoices ──────────────────────────────────────────────────────────────────────────────────

  private requireStripe(): Stripe {
    if (!this.stripe) throw new ServiceUnavailableException('Billing isn’t set up on this server yet.');
    return this.stripe;
  }

  private async customerFor(userId: string): Promise<string> {
    const stripe = this.requireStripe();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.stripeCustomerId) return user.stripeCustomerId;
    const customer = await stripe.customers.create({ email: user.email, name: user.displayName, metadata: { userId: user.id } });
    // Guard against two simultaneous checkouts creating two customers.
    const updated = await this.prisma.user.updateMany({ where: { id: user.id, stripeCustomerId: null }, data: { stripeCustomerId: customer.id } });
    if (updated.count === 1) return customer.id;
    return (await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).stripeCustomerId!;
  }

  async checkout(userId: string, workspaceId: string, planId: 'pro' | 'business', interval: 'month' | 'year'): Promise<{ url: string }> {
    // Only the workspace owner buys or changes its plan (team members share it but can't replace it).
    const member = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (member?.role !== 'OWNER') throw new ForbiddenException('Only the workspace owner can change its plan.');
    const stripe = this.requireStripe();
    const price = await this.prisma.planPrice.findFirst({ where: { planId, interval: interval === 'year' ? 'YEAR' : 'MONTH', active: true } });
    if (!price?.stripePriceId) throw new ServiceUnavailableException('This plan isn’t available for purchase yet.');
    const existing = await this.prisma.subscription.findUnique({ where: { workspaceId } });
    if (existing && ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(existing.status) && existing.stripeSubscriptionId) {
      // Changing plan on an existing subscription goes through the Stripe customer portal (handles proration).
      throw new BadRequestException('You already have a subscription. Use “Manage billing” to change or cancel it.');
    }
    const returnUrl = this.env.BILLING_RETURN_URL ?? `${this.env.PUBLIC_API_URL}/v1/billing/return`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: await this.customerFor(userId),
      line_items: [{ price: price.stripePriceId, quantity: 1 }],
      client_reference_id: workspaceId,
      subscription_data: { metadata: { workspaceId, planId } },
      metadata: { workspaceId, planId },
      allow_promotion_codes: true,
      success_url: `${returnUrl}?status=success`,
      cancel_url: `${returnUrl}?status=cancelled`,
    });
    if (!session.url) throw new ServiceUnavailableException('Stripe didn’t return a checkout page.');
    return { url: session.url };
  }

  async portal(userId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: await this.customerFor(userId),
      return_url: `${this.env.BILLING_RETURN_URL ?? `${this.env.PUBLIC_API_URL}/v1/billing/return`}?status=portal`,
    });
    return { url: session.url };
  }

  async invoices(userId: string): Promise<InvoiceInfo[]> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!this.stripe || !user.stripeCustomerId) return [];
    const list = await this.stripe.invoices.list({ customer: user.stripeCustomerId, limit: 24 });
    return list.data.map((inv) => ({
      id: inv.id ?? '',
      number: inv.number ?? null,
      amountCents: inv.amount_paid || inv.amount_due,
      currency: inv.currency,
      status: inv.status ?? 'unknown',
      createdAt: new Date(inv.created * 1000).toISOString(),
      hostedUrl: inv.hosted_invoice_url ?? null,
    }));
  }

  // ─── Webhooks ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Verifies the Stripe signature, records the event once (idempotent) and applies it. */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ received: true; duplicate?: true }> {
    if (!this.stripe || !this.env.STRIPE_WEBHOOK_SECRET) throw new ServiceUnavailableException('Billing isn’t set up on this server yet.');
    if (!rawBody || !signature) throw new BadRequestException('Missing signature');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new BadRequestException('Invalid signature');
    }
    const seen = await this.prisma.billingEvent.findUnique({ where: { stripeEventId: event.id } });
    if (seen?.processedAt) return { received: true, duplicate: true };
    if (!seen) {
      try {
        await this.prisma.billingEvent.create({ data: { stripeEventId: event.id, type: event.type, payload: event as unknown as object } });
      } catch {
        // A parallel delivery inserted it first; only skip if that one finished.
        const raced = await this.prisma.billingEvent.findUnique({ where: { stripeEventId: event.id } });
        if (raced?.processedAt) return { received: true, duplicate: true };
      }
    }
    // An event that failed earlier (processedAt still empty) is applied again — Stripe retries it for exactly this.
    try {
      await this.apply(event);
      await this.prisma.billingEvent.update({ where: { stripeEventId: event.id }, data: { processedAt: new Date() } });
    } catch (e) {
      await this.prisma.billingEvent.update({ where: { stripeEventId: event.id }, data: { error: (e as Error).message.slice(0, 500) } });
      throw e; // Stripe retries failed deliveries
    }
    return { received: true };
  }

  private async apply(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.syncSubscription(event.data.object, new Date(event.created * 1000));
        return;
      case 'invoice.payment_failed':
        this.logger.warn(`Payment failed for customer ${String(event.data.object.customer)}`);
        return;
      default:
        return; // other events are recorded but need no action
    }
  }

  /** Mirrors a Stripe subscription onto the workspace it was bought for. */
  async syncSubscription(s: Stripe.Subscription, eventAt: Date): Promise<void> {
    const workspaceId = s.metadata['workspaceId'];
    const item = s.items.data[0];
    // The plan comes from the price actually paid (metadata can be edited and goes stale after portal plan changes).
    const price = item?.price.id ? await this.prisma.planPrice.findUnique({ where: { stripePriceId: item.price.id } }) : null;
    const planId = price?.planId;
    if (!workspaceId || !planId || !isPlanId(planId)) {
      this.logger.warn(`Subscription ${s.id} has no workspace metadata or an unknown price — ignored.`);
      return;
    }
    const existing = await this.prisma.subscription.findUnique({ where: { workspaceId } });
    // Stripe can deliver events out of order; never let an older event overwrite a newer state.
    // shortcut: read-then-write, two events for one workspace in the same instant can still race; use a row lock if that shows up.
    if (existing?.lastEventAt && existing.lastEventAt > eventAt) {
      this.logger.log(`Ignored an older event for subscription ${s.id}.`);
      return;
    }
    const data = {
      planId,
      lastEventAt: eventAt,
      status: s.status.toUpperCase() as 'ACTIVE',
      interval: item?.price.recurring?.interval === 'year' ? ('YEAR' as const) : ('MONTH' as const),
      stripeSubscriptionId: s.id,
      currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
      currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      canceledAt: s.canceled_at ? new Date(s.canceled_at * 1000) : null,
      trialEndsAt: s.trial_end ? new Date(s.trial_end * 1000) : null,
    };
    await this.prisma.subscription.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
    await this.prisma.auditLog.create({ data: { workspaceId, action: 'billing.subscription_synced', metadata: { status: s.status, planId } } });
  }
}
