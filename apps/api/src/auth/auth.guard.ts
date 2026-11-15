import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';
import { ENV, type Env } from '../config/env';
import { AuthService } from './auth.service';
import { type AccessClaims, verifyAccessToken } from './crypto';

export type AuthedRequest = Request & { auth?: AccessClaims };

/** Requires a valid `Authorization: Bearer <access token>` whose session hasn't been signed out. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.header('authorization') ?? '';
    const claims = header.startsWith('Bearer ') ? verifyAccessToken(header.slice(7), this.env.JWT_SECRET) : null;
    if (!claims || !(await this.auth.sessionActive(claims.sid))) throw new UnauthorizedException('Please sign in again.');
    req.auth = claims;
    return true;
  }
}

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AccessClaims => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});

/** Validates a request body with a shared Zod schema (errors become 422 via the global filter). */
export const parse = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

export const clientMeta = (req: Request) => ({ userAgent: req.header('user-agent') ?? undefined, ip: req.ip });
