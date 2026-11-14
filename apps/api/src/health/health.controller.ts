import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

const startedAt = Date.now();

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'delyforge-api';
  version: string;
  uptimeSeconds: number;
  checks: { database: 'up' | 'down' };
}

@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Liveness + dependency check. Returns 503 when the database is unreachable. */
  @Get()
  @SkipThrottle()
  @HttpCode(200)
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const dbUp = await this.prisma.isHealthy();
    if (!dbUp) res.status(503);
    return {
      status: dbUp ? 'ok' : 'degraded',
      service: 'delyforge-api',
      version: process.env['npm_package_version'] ?? '0.1.0',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks: { database: dbUp ? 'up' : 'down' },
    };
  }
}
