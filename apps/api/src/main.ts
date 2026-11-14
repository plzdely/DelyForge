import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { loadEnv } from './config/env';
import { createApp } from './create-app';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`DelyForge API listening on http://localhost:${env.PORT}`);
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error((err as Error).message);
  process.exit(1);
});
