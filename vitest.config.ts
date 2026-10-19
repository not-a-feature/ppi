import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '$lib/i18n': fileURLToPath(new URL('./src/lib/i18n.ts', import.meta.url)),
      '$lib/server/auth/policy': fileURLToPath(
        new URL('./src/lib/server/auth/policy.ts', import.meta.url)
      )
    }
  },
  test: { include: ['tests/**/*.test.ts'], fileParallelism: false, testTimeout: 15000 }
});
