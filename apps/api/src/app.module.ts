import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ENV, type Env } from './config/env';
import { HealthController } from './health/health.controller';
import { PlansController } from './plans/plans.controller';
import { PlansService } from './plans/plans.service';
import { PrismaModule } from './prisma/prisma.module';

@Module({})
export class AppModule {
  static register(env: Env): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        PrismaModule,
        // Default: 100 requests / minute / IP. Sensitive routes (auth, AI) will set stricter limits.
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
      ],
      controllers: [HealthController, PlansController],
      providers: [
        { provide: ENV, useValue: env },
        PlansService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [ENV],
    };
  }
}
