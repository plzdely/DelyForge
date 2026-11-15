import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The local `prisma dev` database mixes up queries from parallel connections (error 08P01), so DB test files run one at a time.
    fileParallelism: process.env['DELYFORGE_DB_TESTS'] !== '1',
  },
});
