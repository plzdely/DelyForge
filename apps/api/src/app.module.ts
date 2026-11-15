import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ENV, type Env } from './config/env';
import { HealthController } from './health/health.controller';
import { PlansController } from './plans/plans.controller';
import { PlansService } from './plans/plans.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthController, MeController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { loadEntitlementKeys } from './auth/crypto';
import { BillingController } from './billing/billing.controller';
import { BillingService, ENTITLEMENT_KEYS } from './billing/billing.service';
import { ConsoleMailer, MAILER, type Mailer } from './mail/mailer';
import { AiController } from './ai/ai.controller';
import { MarketplaceController } from './marketplace/marketplace.controller';
import { MarketplaceService } from './marketplace/marketplace.service';
import { AiService } from './ai/ai.service';
import { AI_PROVIDERS, AnthropicProvider, type AiTextProvider } from './ai/provider';

@Module({})
export class AppModule {
  static register(env: Env, overrides: { mailer?: Mailer; aiProviders?: Record<string, AiTextProvider> } = {}): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        PrismaModule,
        // Default: 100 requests / minute / IP. Sensitive routes (auth, AI) will set stricter limits.
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
      ],
      controllers: [HealthController, PlansController, AuthController, MeController, BillingController, AiController, MarketplaceController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: MAILER, useValue: overrides.mailer ?? new ConsoleMailer(env.NODE_ENV === 'production') },
        { provide: ENTITLEMENT_KEYS, useValue: loadEntitlementKeys(env.ENTITLEMENT_PRIVATE_KEY || undefined) },
        PlansService,
        AuthService,
        AuthGuard,
        BillingService,
        {
          provide: AI_PROVIDERS,
          useValue: overrides.aiProviders ?? (env.ANTHROPIC_API_KEY ? { anthropic: new AnthropicProvider(env.ANTHROPIC_API_KEY) } : {}),
        },
        AiService,
        MarketplaceService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [ENV],
    };
  }
}
