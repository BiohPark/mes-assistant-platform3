import { configDefaults, defineConfig } from 'vitest/config'
import { sourceConditions } from '../../vitest.shared.js'

// 단위 테스트 — DB 없이 어디서나 (ubuntu·windows CI). DB 필요한 테스트는 *.db.test.ts → vitest.db.config.ts
export default defineConfig({
  ...sourceConditions,
  test: { setupFiles: ['src/test/classificationUnitSetup.ts'], exclude: [...configDefaults.exclude, 'src/**/*.db.test.ts'] },
})
