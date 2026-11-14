import 'reflect-metadata';
import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/request-id.middleware';
import type { Env } from './config/env';

/** Builds the configured Nest application. Shared by `main.ts` and the test suite. */
export async function createApp(env: Env): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(env), {
    logger: new ConsoleLogger({
      json: env.NODE_ENV === 'production',
      prefix: 'DelyForge',
      logLevels: env.NODE_ENV === 'test' ? ['error', 'warn'] : ['log', 'error', 'warn', 'debug'],
    }),
    // Raw body is needed later to verify Stripe webhook signatures.
    rawBody: true,
  });

  app.use(requestIdMiddleware);
  app.use(helmet());
  app.enableCors({
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
  });
  app.enableShutdownHooks();
  return app;
}
