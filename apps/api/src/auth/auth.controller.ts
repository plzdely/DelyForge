import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  passwordSchema,
  refreshSchema,
  registerSchema,
  updateProfileSchema,
} from '@delyforge/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { Auth, AuthGuard, clientMeta, parse } from './auth.guard';
import { AuthService } from './auth.service';
import { DiscordLinkService } from './discord.service';
import type { AccessClaims } from './crypto';

/** Strict limits on endpoints attackers would brute-force. */
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DiscordLinkService) private readonly discord: DiscordLinkService,
  ) {}

  /** Discord sends the browser back here after the person approves (or cancels) linking. */
  @Get('discord/callback')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async discordCallback(@Query('code') code?: string, @Query('state') state?: string, @Query('error') error?: string) {
    const r = await this.discord.callback({ code, state, error });
    return page(r.title, r.message);
  }

  @Post('register')
  @Throttle(STRICT)
  register(@Body() body: unknown, @Req() req: Request) {
    const input = parse(registerSchema, body);
    return this.auth.register(input, { ...clientMeta(req), deviceName: 'DelyForge Desktop' });
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(STRICT)
  login(@Body() body: unknown, @Req() req: Request) {
    return this.auth.login(parse(loginSchema, body), clientMeta(req));
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() body: unknown, @Req() req: Request) {
    return this.auth.refresh(parse(refreshSchema, body).refreshToken, clientMeta(req));
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@Auth() a: AccessClaims) {
    await this.auth.logout(a.sid);
  }

  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgot(@Body() body: unknown) {
    await this.auth.forgotPassword(parse(forgotPasswordSchema, body).email);
    return { message: 'If that email has an account, a reset link is on its way.' };
  }

  @Post('resend-verification')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  async resend(@Auth() a: AccessClaims) {
    await this.auth.resendVerification(a.sub);
    return { message: 'Verification email sent.' };
  }

  // ── Pages opened from email links (plain HTML, no scripts) ──

  @Get('verify-email')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
  async verifyEmailPage(@Query('token') token = '') {
    const ok = token.length >= 20 && (await this.auth.verifyEmail(token));
    return page(ok ? 'Email confirmed ✅' : 'Link expired', ok ? 'Your email address is confirmed. You can go back to DelyForge.' : 'This link has expired or was already used. Request a new one from DelyForge.');
  }

  @Get('reset-password')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
  resetForm(@Query('token') token = '') {
    return page(
      'Choose a new password',
      `<form method="post" action="/v1/auth/reset-password">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <label>New password (at least 10 characters)<br><input type="password" name="password" minlength="10" maxlength="200" required autocomplete="new-password"></label>
        <button type="submit">Save password</button>
      </form>`,
      true,
    );
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
  async reset(@Body() body: unknown) {
    const parsed = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).safeParse(body);
    if (!parsed.success) return page('Couldn’t save', parsed.error.issues[0]?.message ?? 'Invalid request');
    const ok = await this.auth.resetPassword(parsed.data.token, parsed.data.password);
    return page(ok ? 'Password changed ✅' : 'Link expired', ok ? 'Your password was changed and every device was signed out. Sign in again in DelyForge.' : 'This link has expired or was already used. Request a new one from DelyForge.');
  }
}

@Controller('v1/me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DiscordLinkService) private readonly discord: DiscordLinkService,
  ) {}

  /** Starts linking: returns the Discord page to open in the browser. */
  @Post('discord')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  linkDiscord(@Auth() a: AccessClaims) {
    return this.discord.start(a.sub);
  }

  @Get()
  me(@Auth() a: AccessClaims) {
    return this.auth.profile(a.sub, a.ws);
  }

  @Patch()
  update(@Auth() a: AccessClaims, @Body() body: unknown) {
    return this.auth.updateProfile(a.sub, parse(updateProfileSchema, body).displayName, a.ws);
  }

  @Post('password')
  @HttpCode(204)
  @Throttle(STRICT)
  async password(@Auth() a: AccessClaims, @Body() body: unknown) {
    const input = parse(changePasswordSchema, body);
    await this.auth.changePassword(a.sub, a.sid, input.currentPassword, input.newPassword);
  }

  @Get('sessions')
  sessions(@Auth() a: AccessClaims) {
    return this.auth.sessions(a.sub, a.sid);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(@Auth() a: AccessClaims, @Param('id') id: string) {
    await this.auth.revokeSession(a.sub, id);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function page(title: string, body: string, raw = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — DelyForge</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090d;color:#ededf3;font:15px/1.5 system-ui,sans-serif}
main{max-width:420px;padding:32px;border:1px solid #21212b;border-radius:14px;background:#121219}h1{font-size:20px;margin:0 0 8px}p{color:#a1a1b5}
input{width:100%;box-sizing:border-box;margin:8px 0 16px;padding:10px;border-radius:8px;border:1px solid #2e2e3a;background:#0c0c12;color:#ededf3}
button{padding:10px 16px;border:0;border-radius:8px;background:#7c5cff;color:#fff;font-weight:600;cursor:pointer}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${raw ? body : `<p>${escapeHtml(body)}</p>`}</main></body></html>`;
}
