import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { aiBuilderRequestSchema, aiProposalDecisionSchema, aiTroubleshootRequestSchema } from '@delyforge/shared';
import { Auth, AuthGuard, parse } from '../auth/auth.guard';
import type { AccessClaims } from '../auth/crypto';
import { AiService } from './ai.service';

@Controller('v1/ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}

  @Get('usage')
  usage(@Auth() a: AccessClaims) {
    return this.ai.usage(a.sub, a.ws);
  }

  @Post('bot-builder')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  buildBot(@Auth() a: AccessClaims, @Body() body: unknown) {
    return this.ai.buildBot(a.sub, a.ws, parse(aiBuilderRequestSchema, body));
  }

  @Post('troubleshoot')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  troubleshoot(@Auth() a: AccessClaims, @Body() body: unknown) {
    return this.ai.troubleshoot(a.sub, a.ws, parse(aiTroubleshootRequestSchema, body));
  }

  @Post('proposals/:id/decision')
  @HttpCode(204)
  async decide(@Auth() a: AccessClaims, @Param('id') id: string, @Body() body: unknown) {
    await this.ai.decide(a.sub, id, parse(aiProposalDecisionSchema, body).decision);
  }
}
