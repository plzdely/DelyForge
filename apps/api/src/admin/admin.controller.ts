import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { adminListingStatusSchema, adminOverrideSchema, adminReviewHiddenSchema, adminUserStatusSchema } from '@delyforge/shared';
import { z } from 'zod';
import { Auth, AuthGuard, parse } from '../auth/auth.guard';
import type { AccessClaims } from '../auth/crypto';
import { AdminService } from './admin.service';

@Controller('v1/admin')
@UseGuards(AuthGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get('overview')
  async overview(@Auth() a: AccessClaims) {
    await this.admin.require(a.sub, 'support');
    return this.admin.overview();
  }

  @Get('users')
  async users(@Auth() a: AccessClaims, @Query() query: unknown) {
    await this.admin.require(a.sub, 'support');
    return this.admin.users(parse(z.object({ q: z.string().trim().max(100).default('') }), query).q);
  }

  @Get('audit')
  async audit(@Auth() a: AccessClaims) {
    await this.admin.require(a.sub, 'support');
    return this.admin.auditLog();
  }

  @Post('users/:id/status')
  @HttpCode(204)
  async userStatus(@Auth() a: AccessClaims, @Param('id') id: string, @Body() body: unknown) {
    await this.admin.require(a.sub, 'admin');
    const input = parse(adminUserStatusSchema, body);
    await this.admin.setUserStatus(a.sub, id, input.status, input.reason);
  }

  @Post('workspaces/:id/overrides')
  @HttpCode(204)
  async grant(@Auth() a: AccessClaims, @Param('id') id: string, @Body() body: unknown) {
    await this.admin.require(a.sub, 'admin');
    await this.admin.grantOverride(a.sub, id, parse(adminOverrideSchema, body));
  }

  @Delete('overrides/:id')
  @HttpCode(204)
  async revoke(@Auth() a: AccessClaims, @Param('id') id: string) {
    await this.admin.require(a.sub, 'admin');
    await this.admin.revokeOverride(a.sub, id);
  }

  @Post('listings/:slug/status')
  @HttpCode(204)
  async listingStatus(@Auth() a: AccessClaims, @Param('slug') slug: string, @Body() body: unknown) {
    await this.admin.require(a.sub, 'admin');
    const input = parse(adminListingStatusSchema, body);
    await this.admin.setListingStatus(a.sub, slug, input.status, input.reason);
  }

  @Post('reviews/:id/hidden')
  @HttpCode(204)
  async reviewHidden(@Auth() a: AccessClaims, @Param('id') id: string, @Body() body: unknown) {
    await this.admin.require(a.sub, 'support');
    await this.admin.setReviewHidden(a.sub, id, parse(adminReviewHiddenSchema, body).hidden);
  }
}
