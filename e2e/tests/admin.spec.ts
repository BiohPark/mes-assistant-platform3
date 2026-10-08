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
  const previous = (await (await page.request.get('/api/settings')).json()) as { defaultModel: string; fileMaxPerRequest?: number }
  const originalOrder = ((await (await page.request.get('/api/assistants')).json()) as Array<{ id: string }>).map((row) => row.id)
  let id = ''
  const level1 = `E2E 분류 ${Date.now()}`
  const level2 = `E2E 하위 ${Date.now()}`
  try {
    await page.goto('/assistants/manage')
    await page.getByRole('button', { name: '새 에이전트' }).click()
    const editor = page.getByRole('dialog', { name: '에이전트 편집' })
    await expect(editor.getByLabel('ID', { exact: true })).toHaveCount(0)
    await editor.getByRole('textbox', { name: '이름', exact: true }).fill('E2E 관리 도우미') // Field: 라벨이 입력을 감싸지 않고 htmlFor로 연결
    for (const [label, name] of [['분류 1', level1], ['분류 2', level2]] as const) {
      const input = editor.getByRole('combobox', { name: label })
      await input.fill(name)
      await expect(page.getByRole('option', { name: `새로 추가: ${name}` })).toBeVisible()
      await input.press('Enter')
    }
    const ownerPicker = editor.getByRole('combobox', { name: '담당자' })
    await ownerPicker.click()
    await expect(page.getByRole('option').first()).toBeVisible()
    await ownerPicker.press('ArrowDown')
    await ownerPicker.press('Enter')
    const creation = page.waitForResponse((response) => response.url().endsWith('/api/assistants') && response.request().method() === 'POST')
    await editor.getByRole('button', { name: '저장', exact: true }).click()
    const created = await creation
    expect(created.status()).toBe(201)
    expect(created.request().postDataJSON()).not.toHaveProperty('id')
    expect(created.request().postDataJSON()).toMatchObject({ level1, level2 })
    expect(created.request().postDataJSON()).not.toHaveProperty('level1CodeId')
    id = ((await created.json()) as { id: string }).id
    expect(id).toMatch(/^a-[a-f0-9]{12}$/)
    await expect(editor).toBeHidden()
    await page.getByRole('button', { name: '분류 코드', exact: true }).click()
    await expect(page.getByRole('heading', { name: '분류 1', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '분류 2', exact: true })).toBeVisible()
    const codeRow = page.getByRole('textbox', { name: `${level1} 이름` }).locator('..')
    await expect(codeRow.getByText('자동', { exact: true })).toBeVisible()
    await expect(codeRow.getByText('사용 1', { exact: true })).toBeVisible()
    await expect(page.getByRole('combobox')).toHaveCount(0)
    await page.goto('/')
    await expect.poll(async () => await page.getByText('E2E 관리 도우미').count()).toBeGreaterThan(0)
    await page.goto('/assistants/manage')
    await expect(page.getByText('E2E 관리 도우미', { exact: true })).toBeVisible()
    await expect(page.getByText(id, { exact: true })).toHaveCount(0) // 목록 로드 전에 순서 편집을 누르면 초안이 비어 draggable 카드가 없다
    await page.getByRole('button', { name: '순서 편집' }).click()
    const cards = page.locator('[draggable="true"]')
    await cards.first().dragTo(cards.last()) // 시드 에이전트를 뒤로 — 새 에이전트가 맨 앞에 오면 병렬 spec들이 assistants[0]으로 집어 삭제가 막힌다
    await page.getByRole('button', { name: '저장', exact: true }).last().click()
    await expect(page.getByText('순서를 저장했습니다')).toBeVisible()
    await page.goto('/settings')
    // 기본 모델은 .env 정본 — 읽기 전용 줄만 있고 입력란이 없다. 쓰기 DTO에 보내면 400 (S7 C2)
    await expect(page.locator('form').getByText(previous.defaultModel, { exact: true })).toBeVisible()
    await expect(page.getByLabel('기본 모델')).toHaveCount(0)
    expect((await page.request.patch('/api/settings', { data: { defaultModel: 'e2e-model' } })).status()).toBe(400)
    await page.getByLabel('첨부 개수 한도').fill('7')
    await page.getByRole('button', { name: '설정 저장' }).click()
    await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).fileMaxPerRequest).toBe(7)
    expect((await (await page.request.get('/api/settings')).json()).defaultModel).toBe(previous.defaultModel)
  } finally {
    // 순서 복구 → 만든 에이전트 삭제: 같은 DB를 쓰는 home.spec의 시드 카드 수·순서 단언이 흔들리지 않게
    const current = (await (await page.request.get('/api/assistants')).json()) as Array<{ id: string; revision: number }>
    const revisions = Object.fromEntries(current.map((row) => [row.id, row.revision]))
    await page.request.put('/api/assistants/order', { data: { ids: [...originalOrder.filter((row) => row !== id), id].filter((row) => row in revisions), revisions } })
    if (id) {
      const removed = await page.request.delete(`/api/assistants/${id}`)
      expect(removed.status(), await removed.text()).toBe(204)
      const codes = (await (await page.request.get('/api/codes?includeInactive=true')).json()) as Array<{ name: string }>
      expect(codes.filter(row => row.name === level1 || row.name === level2)).toEqual([])
    }
    if (previous.fileMaxPerRequest !== undefined) {
      const restored = await page.request.patch('/api/settings', { data: { fileMaxPerRequest: previous.fileMaxPerRequest } })
      expect(restored.ok()).toBe(true)
    } else {
      const pool = createPool(process.env.DATABASE_URL!, 1)
      try { await pool.execute("delete from app_setting where `key` = 'fileMaxPerRequest'") }
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
  expect((await page.request.patch('/api/settings', { data: { fileDelivery: 'inline' } })).status()).toBe(403)
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
