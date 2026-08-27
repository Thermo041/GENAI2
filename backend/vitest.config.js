import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
    globals: false,
    reporters: ['default'],
    pool: 'threads',
    env: { NODE_ENV: 'test' },
  },
});
