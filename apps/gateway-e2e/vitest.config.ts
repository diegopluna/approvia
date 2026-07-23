import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['apps/gateway-e2e/src/**/*.spec.ts'],
  },
})
