import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const domainSrc = fileURLToPath(new URL('../domain/src/index.ts', import.meta.url))
export default defineConfig({
  resolve: {
    conditions: ['source'],
    alias: [{ find: '@mes/domain', replacement: domainSrc }],
  },
})
