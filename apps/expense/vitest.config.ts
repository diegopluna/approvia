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
    include: ['apps/expense/src/**/*.spec.ts'],
    // Testes de workflow usam o test server do Temporal (download no primeiro
    // uso) e replay real de timers; folga acima do padrão de 5s.
    testTimeout: 30000,
    hookTimeout: 120000,
  },
})
