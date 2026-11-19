import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['apps/web/src/**/*.test.ts', 'packages/shared/src/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'api',
      include: ['apps/api/src/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
    },
  },
]);
