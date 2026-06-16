import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Run tests sequentially — SQLite is not safe with concurrent in-memory writes
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
