import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { checkoutSchema } from '@delyforge/shared';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Auth, AuthGuard, parse } from '../auth/auth.guard';
import { escapeHtml } from '../auth/auth.controller';
import type { AccessClaims } from '../auth/crypto';
import { BillingService } from './billing.service';

@Controller('v1')
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  /** The signed plan certificate for the signed-in user's workspace. */
  @Get('entitlements')
  @UseGuards(AuthGuard)
  async entitlements(@Auth() a: AccessClaims) {
    const { token, claims } = await this.billing.entitlements(a.sub, a.ws);
    return { token, claims, billingConfigured: this.billing.configured };
  }

  /** Public key apps use to verify plan certificates (production builds embed it rather than fetching it). */
  @Get('entitlements/public-key')
  publicKey() {
    return { publicKey: this.billing.publicKey() };
  }

  @Post('billing/checkout')
  @UseGuards(AuthGuard)
  checkout(@Auth() a: AccessClaims, @Body() body: unknown) {
    const input = parse(checkoutSchema, body);
    return this.billing.checkout(a.sub, a.ws, input.planId, input.interval);
  }

  @Post('billing/portal')
  @UseGuards(AuthGuard)
  portal(@Auth() a: AccessClaims) {
    return this.billing.portal(a.sub);
  }

  @Get('billing/invoices')
  @UseGuards(AuthGuard)
  invoices(@Auth() a: AccessClaims) {
    return this.billing.invoices(a.sub);
  }

  /** Stripe → us. Verified with the webhook signing secret over the raw request body. */
  @Post('billing/webhook')
  @HttpCode(200)
  @SkipThrottle()
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.billing.handleWebhook(req.rawBody, signature);
  }

  /** Where Stripe sends the browser after checkout or the portal. */
  @Get('billing/return')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
  returnPage(@Query('status') status = '') {
    const text =
      status === 'success'
        ? 'Thank you! Your subscription is active. Go back to DelyForge — your plan updates within a few seconds.'
        : status === 'portal'
          ? 'Your billing changes were saved. Go back to DelyForge.'
          : 'Checkout was cancelled — nothing was charged. You can close this tab.';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DelyForge billing</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090d;color:#ededf3;font:15px/1.5 system-ui}main{max-width:420px;padding:32px;border:1px solid #21212b;border-radius:14px;background:#121219}</style></head><body><main><h1>DelyForge</h1><p>${escapeHtml(text)}</p></main></body></html>`;
  }
}
