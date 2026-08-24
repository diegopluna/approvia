import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@approvia/events': fileURLToPath(
        new URL('../../packages/events/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['apps/gateway-e2e/src/**/*.spec.ts'],
  },
})
