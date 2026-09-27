import { configDefaults, defineConfig } from 'vitest/config'

// 단위 테스트 — DB 없이 어디서나 (ubuntu·windows CI). DB 필요한 테스트는 *.db.test.ts → vitest.db.config.ts
export default defineConfig({
  resolve: { conditions: ['source'] },
  test: { exclude: [...configDefaults.exclude, 'src/**/*.db.test.ts'] },
})
