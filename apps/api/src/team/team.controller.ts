import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { switchWorkspaceSchema, teamInviteSchema } from '@delyforge/shared';
import type { Request } from 'express';
import { Auth, AuthGuard, parse } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { AccessClaims } from '../auth/crypto';
import { TeamService } from './team.service';

@Controller('v1/team')
@UseGuards(AuthGuard)
export class TeamController {
  constructor(
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  info(@Auth() a: AccessClaims) {
    return this.team.info(a.sub, a.ws);
  }

  @Post('invites')
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async invite(@Auth() a: AccessClaims, @Body() body: unknown) {
    const input = parse(teamInviteSchema, body);
    await this.team.invite(a.sub, a.ws, input.email, input.role);
  }

  @Delete('invites/:id')
  @HttpCode(204)
  async revoke(@Auth() a: AccessClaims, @Param('id') id: string) {
    await this.team.revokeInvite(a.sub, a.ws, id);
  }

  @Delete('members/:userId')
  @HttpCode(204)
  async remove(@Auth() a: AccessClaims, @Param('userId') userId: string) {
    await this.team.removeMember(a.sub, a.ws, userId);
  }

  @Get('my-invites')
  myInvites(@Auth() a: AccessClaims) {
    return this.team.myInvites(a.sub);
  }

  @Post('my-invites/:id/accept')
  @HttpCode(200)
  accept(@Auth() a: AccessClaims, @Param('id') id: string) {
    return this.team.accept(a.sub, id);
  }

  /** Makes another workspace active on this device; returns new tokens. */
  @Post('switch')
  @HttpCode(200)
  switch(@Auth() a: AccessClaims, @Body() body: unknown, @Req() req: Request) {
    return this.auth.switchWorkspace(a.sub, a.sid, parse(switchWorkspaceSchema, body).workspaceId, { userAgent: req.headers['user-agent'], ip: req.ip });
  }
}
