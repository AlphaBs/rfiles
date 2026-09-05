import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          CLIENT_SECRET: 'test-secret',
          S3_ACCESS_KEY: 'test-access-key',
          S3_SECRET_ACCESS_KEY: 'test-secret-key',
          S3_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com/files/',
        },
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
    },
  },
});
