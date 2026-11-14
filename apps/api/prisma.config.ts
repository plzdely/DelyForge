import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --import tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
    // `prisma migrate dev` compares against a scratch "shadow" database. Prisma's built-in local Postgres runs it on
    // its own port; with a normal Postgres server, leave this unset and Prisma creates one automatically.
    ...(process.env['SHADOW_DATABASE_URL'] ? { shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'] } : {}),
  },
});
