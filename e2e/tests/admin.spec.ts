import { expect, test, type Page } from '@playwright/test'
import { createPool } from '../../apps/api/src/db/connection.js'

const password = 'e2e-password-1234'
async function owner(page: Page) {
  const signup = await page.request.post('/api/auth/signup', { data: { loginId: 'dev-owner', password } })
  if (signup.status() === 409) await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } }).then((response) => expect(response.ok()).toBe(true))
  else expect(signup.ok()).toBe(true)
  expect((await (await page.request.get('/api/me')).json()).roles).toContain('system_owner')
}
async function member(page: Page) {
  const loginId = `e2e-admin-${Date.now().toString(36)}`
  const response = await page.request.post('/api/auth/signup', { data: { loginId, password } })
  expect(response.ok()).toBe(true)
  return { loginId, id: (await response.json()).id as string }
}

test('SO 에이전트 추가 → 허브 카드 → 순서 저장 → 설정 저장', async ({ page }) => {
  await owner(page)
  const previous = (await (await page.request.get('/api/settings')).json()) as { defaultModel?: string }
  const originalOrder = ((await (await page.request.get('/api/assistants')).json()) as Array<{ id: string }>).map((row) => row.id)
  const id = `admin-${Date.now().toString(36)}`
  try {
    await page.goto('/assistants/manage')
    await page.getByRole('button', { name: '새 에이전트' }).click()
    const editor = page.getByRole('dialog', { name: '에이전트 편집' })
    await editor.getByText('ID', { exact: true }).locator('input').fill(id)
    await editor.getByText('이름', { exact: true }).locator('input').fill('E2E 관리 도우미')
    await editor.getByRole('combobox', { name: '분류 1' }).selectOption({ index: 1 })
    await editor.getByRole('combobox', { name: '분류 2' }).selectOption({ index: 1 })
    await editor.getByRole('combobox', { name: '담당자' }).selectOption({ index: 1 })
    await editor.getByRole('button', { name: '저장', exact: true }).click()
    await expect(editor).toBeHidden()
    await page.goto('/')
    await expect.poll(async () => await page.getByText('E2E 관리 도우미').count()).toBeGreaterThan(0)
    await page.goto('/assistants/manage')
    await page.getByRole('button', { name: '순서 편집' }).click()
    const cards = page.locator('[draggable="true"]')
    await cards.first().dragTo(cards.last()) // 시드 에이전트를 뒤로 — 새 에이전트가 맨 앞에 오면 병렬 spec들이 assistants[0]으로 집어 삭제가 막힌다
    await page.getByRole('button', { name: '저장', exact: true }).last().click()
    await expect(page.getByText('순서를 저장했습니다')).toBeVisible()
    await page.goto('/settings')
    await page.getByLabel('기본 모델').fill('e2e-model')
    await page.getByRole('button', { name: '설정 저장' }).click()
    await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).defaultModel).toBe('e2e-model')
  } finally {
    // 순서 복구 → 만든 에이전트 삭제: 같은 DB를 쓰는 home.spec의 시드 카드 수·순서 단언이 흔들리지 않게
    const current = (await (await page.request.get('/api/assistants')).json()) as Array<{ id: string; revision: number }>
    const revisions = Object.fromEntries(current.map((row) => [row.id, row.revision]))
    await page.request.put('/api/assistants/order', { data: { ids: [...originalOrder.filter((row) => row !== id), id].filter((row) => row in revisions), revisions } })
    const removed = await page.request.delete(`/api/assistants/${id}`)
    expect(removed.status(), await removed.text()).toBe(204)
    if (previous.defaultModel !== undefined) {
      const restored = await page.request.patch('/api/settings', { data: { defaultModel: previous.defaultModel } })
      expect(restored.ok()).toBe(true)
    } else {
      const pool = createPool(process.env.DATABASE_URL!, 1)
      try { await pool.execute("delete from app_setting where `key` = 'defaultModel'") }
      finally { await pool.end() }
    }
  }
})

test('담당자는 관리 화면과 쓰기 API에 접근할 수 없다', async ({ page }) => {
  await member(page)
  await page.goto('/assistants/manage')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/$/)
  expect((await page.request.patch('/api/settings', { data: { defaultModel: 'denied' } })).status()).toBe(403)
  expect((await page.request.post('/api/assistants', { data: {} })).status()).toBe(403)
})

test('임시 비밀번호 후 변경 강제, 변경 뒤 정상 로그인', async ({ page, browser }) => {
  const user = await member(page)
  await owner(page)
  const issued = await page.request.post(`/api/users/${user.id}/temporary-password`)
  expect(issued.ok()).toBe(true)
  const temporary = ((await issued.json()) as { temporaryPassword: string }).temporaryPassword
  const context = await browser.newContext({ baseURL: process.env.APP_ORIGIN ?? 'http://localhost:5173' })
  const next = await context.newPage()
  try {
    await next.goto('/login')
    await next.getByLabel('ID').fill(user.loginId)
    await next.getByLabel('비밀번호').fill(temporary)
    await next.getByRole('button', { name: '로그인' }).click()
    await expect(next.getByText('비밀번호를 변경해야 계속할 수 있습니다')).toBeVisible()
    expect((await next.request.get('/api/settings')).status()).toBe(403)
    await next.getByLabel('현재 비밀번호').fill(temporary)
    await next.getByLabel('새 비밀번호', { exact: true }).fill('new-e2e-password-1234')
    await next.getByLabel('새 비밀번호 확인').fill('new-e2e-password-1234')
    await next.getByRole('button', { name: '변경', exact: true }).click()
    await expect(next).toHaveURL(/\/login$/)
    await next.getByLabel('ID').fill(user.loginId)
    await next.getByLabel('비밀번호', { exact: true }).fill('new-e2e-password-1234')
    await next.getByRole('button', { name: '로그인' }).click()
    await expect(next.getByRole('heading', { name: '에이전트 허브' })).toBeVisible()
  } finally { await context.close() }
})
