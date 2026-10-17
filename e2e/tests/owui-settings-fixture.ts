import { test as base } from '@playwright/test'
import { createPool } from '../../apps/api/src/db/connection.js'

export { expect, type Page } from '@playwright/test'

// 서로 다른 spec/worker도 같은 앱 설정과 fake OWUI를 쓴다. 테스트의 복원까지 잠근다.
// MySQL 연결 잠금은 worker가 종료되면 자동 해제되고, 대기 시간은 테스트 본문 제한과 분리한다.
export const test = base.extend<{ owuiSettingsLock: void }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture dependencies.
  owuiSettingsLock: [async ({}, use) => {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) throw new Error('DATABASE_URL is required for shared OpenWebUI settings tests')
    const pool = createPool(databaseUrl, 1)
    try {
      const connection = await pool.getConnection()
      try {
        const [result] = await connection.query('select get_lock(?, 300) as acquired', ['mes:e2e:owui-settings'])
        if ((result as Array<{ acquired: number | null }>)[0]?.acquired !== 1) throw new Error('Timed out waiting for shared OpenWebUI settings')
        await use()
      } finally {
        // 연결을 닫으면 예외·타임아웃에도 잠금을 남기지 않는다.
        connection.destroy()
      }
    } finally {
      await pool.end()
    }
  }, { auto: true, timeout: 360_000 }],
})
