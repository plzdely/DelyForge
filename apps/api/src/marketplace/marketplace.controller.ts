import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LISTING_TYPES, developerProfileSchema, moderateVersionSchema, reviewSchema, submitListingSchema } from '@delyforge/shared';
import { z } from 'zod';
import { Auth, AuthGuard, parse } from '../auth/auth.guard';
import type { AccessClaims } from '../auth/crypto';
import { MarketplaceService } from './marketplace.service';

const listQuery = z.object({
  type: z.enum(LISTING_TYPES).optional(),
  q: z.string().trim().max(60).optional(),
  sort: z.enum(['popular', 'rating', 'new']).optional(),
});

@Controller('v1/marketplace')
export class MarketplaceController {
  constructor(@Inject(MarketplaceService) private readonly market: MarketplaceService) {}

  @Get('listings')
  list(@Query() query: unknown) {
    return this.market.list(parse(listQuery, query));
  }

  @Get('listings/:slug')
  detail(@Param('slug') slug: string) {
    return this.market.detail(slug);
  }

  @Post('listings/:slug/install')
  @UseGuards(AuthGuard)
  install(@Auth() a: AccessClaims, @Param('slug') slug: string) {
    return this.market.install(a.sub, a.ws, slug);
  }

  @Post('listings/:slug/reviews')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async review(@Auth() a: AccessClaims, @Param('slug') slug: string, @Body() body: unknown) {
    await this.market.review(a.sub, slug, parse(reviewSchema, body));
  }

  @Get('developer')
  @UseGuards(AuthGuard)
  developer(@Auth() a: AccessClaims) {
    return this.market.developer(a.sub);
  }

  @Post('developer')
  @UseGuards(AuthGuard)
  becomeDeveloper(@Auth() a: AccessClaims, @Body() body: unknown) {
    return this.market.becomeDeveloper(a.sub, parse(developerProfileSchema, body));
  }

  @Get('developer/listings')
  @UseGuards(AuthGuard)
  mine(@Auth() a: AccessClaims) {
    return this.market.mine(a.sub);
  }

  @Post('developer/listings')
  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  submit(@Auth() a: AccessClaims, @Body() body: unknown) {
    return this.market.submit(a.sub, parse(submitListingSchema, body));
  }

  @Get('review-queue')
  @UseGuards(AuthGuard)
  queue(@Auth() a: AccessClaims) {
    return this.market.queue(a.sub);
  }

  @Post('review-queue/:versionId')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async moderate(@Auth() a: AccessClaims, @Param('versionId') versionId: string, @Body() body: unknown) {
    const input = parse(moderateVersionSchema, body);
    await this.market.moderate(a.sub, versionId, input.approve, input.notes);
  }
}
