import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test'
import type { Assistant } from '../../packages/contracts/src/catalog.js'
import { createPool } from '../../apps/api/src/db/connection.js'

const password = 'e2e-password-1234'
async function owner(api: APIRequestContext) {
  // E2E 서버가 dev-owner를 e2e-password-1234로 시드한다. 가입(409)·틀린 비밀번호는 ID 실패로 세어져 다른 spec까지 시도 제한에 걸리므로 바로 로그인한다
  expect((await api.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
  expect((await (await api.get('/api/me')).json()).roles).toContain('system_owner')
}
async function member(page: Page) {
  const loginId = `e2e-admin-${Date.now().toString(36)}`
  const response = await page.request.post('/api/auth/signup', { data: { loginId, password } })
  expect(response.ok()).toBe(true)
  return { loginId, id: (await response.json()).id as string }
}

type ManagedAgent = { api: APIRequestContext; id: string; level1: string; level2: string; orderChanged: boolean; settingsChanged: boolean; defaultModel: string }
const test = base.extend<{ managedAgent: ManagedAgent }>({
  managedAgent: [async ({ playwright, baseURL }, use) => {
    // 페이지나 본문 timeout에 묶이지 않는 API 컨텍스트와 fixture teardown 예산을 쓴다.
    const api = await playwright.request.newContext({ baseURL, timeout: 5_000 })
    try {
      await owner(api)
      const previous = (await (await api.get('/api/settings')).json()) as { defaultModel: string; fileMaxPerRequest?: number }
      const originalOrder = ((await (await api.get('/api/assistants')).json()) as Assistant[]).map(row => row.id)
      const state = { api, id: '', level1: `E2E 분류 ${Date.now()}`, level2: `E2E 하위 ${Date.now()}`, orderChanged: false, settingsChanged: false, defaultModel: previous.defaultModel }
      const errors: unknown[] = []
      try { await use(state) }
      finally {
        const attempt = async (action: () => Promise<void>) => { try { await action() } catch (error) { errors.push(error) } }
        // 삭제를 먼저 시도한다. POST 뒤 ID 단언/응답 대기가 실패해도 이 실행의 고유 경로로 찾는다.
        await attempt(async () => {
          let ids = state.id ? [state.id] : []
          if (!state.id) {
            const response = await api.get('/api/assistants')
            expect(response.ok()).toBe(true)
            const rows = await response.json() as Assistant[]
            ids = rows.filter(row => !originalOrder.includes(row.id) && row.name === 'E2E 관리 도우미'
              && (row.classifications ?? [row]).some(path => path.level1 === state.level1 && path.level2 === state.level2)).map(row => row.id)
          }
          for (const id of ids) await attempt(async () => {
            const removed = await api.delete(`/api/assistants/${id}`)
            expect(removed.status(), await removed.text()).toBe(204)
          })
          const codes = (await (await api.get('/api/codes?includeInactive=true')).json()) as Array<{ name: string }>
          expect(codes.filter(row => row.name === state.level1 || row.name === state.level2)).toEqual([])
        })
        // 복구 중 하나가 실패해도 나머지는 모두 실행하고 teardown 오류로 따로 보고한다.
        if (state.orderChanged) await attempt(async () => {
          const response = await api.get('/api/assistants')
          expect(response.ok()).toBe(true)
          const current = await response.json() as Assistant[]
          const revisions = Object.fromEntries(current.map(row => [row.id, row.revision]))
          const ids = [...originalOrder.filter(id => id in revisions), ...current.filter(row => !originalOrder.includes(row.id)).map(row => row.id)]
          const restored = await api.put('/api/assistants/order', { data: { ids, revisions } })
          expect(restored.ok(), await restored.text()).toBe(true)
        })
        if (state.settingsChanged) await attempt(async () => {
          if (previous.fileMaxPerRequest !== undefined) {
            const restored = await api.patch('/api/settings', { data: { fileMaxPerRequest: previous.fileMaxPerRequest } })
            expect(restored.ok()).toBe(true)
          } else {
            const pool = createPool(process.env.DATABASE_URL!, 1)
            try { await pool.execute("delete from app_setting where `key` = 'fileMaxPerRequest'") }
            finally { await pool.end() }
          }
        })
      }
      if (errors.length) throw new AggregateError(errors, '관리 E2E cleanup 실패')
    } finally { await api.dispose() }
  }, { timeout: 30_000 }],
})

test('SO 에이전트 추가 → 허브 카드 → 순서 저장 → 설정 저장', async ({ page, managedAgent }) => {
  await owner(page.request)
  const { level1, level2 } = managedAgent
  await page.goto('/assistants/manage')
  await page.getByRole('button', { name: '새 에이전트' }).click()
  const editor = page.getByRole('dialog', { name: '에이전트 편집' })
  await expect(editor.getByLabel('ID', { exact: true })).toHaveCount(0)
  await expect(editor.getByRole('textbox', { name: 'OpenWebUI 링크(비우면 설정 규칙)', exact: true })).toHaveCount(0)
  await expect(editor.getByText('기존 링크 재정의 있음', { exact: true })).toHaveCount(0)
  await expect(editor.getByRole('button', { name: '경로 1 제거', exact: true })).toBeDisabled()
  await editor.getByRole('button', { name: '+ 경로 추가', exact: true }).click()
  await expect(editor.getByRole('group', { name: '경로 2', exact: true })).toBeVisible()
  await editor.getByRole('button', { name: '경로 2 제거', exact: true }).click()
  await editor.getByRole('textbox', { name: '이름', exact: true }).fill('E2E 관리 도우미') // Field: 라벨이 입력을 감싸지 않고 htmlFor로 연결
  for (const [label, name] of [['분류 1', level1], ['분류 2', level2]] as const) {
    const input = editor.getByRole('group', { name: '경로 1', exact: true }).getByRole('combobox', { name: label, exact: true })
    await input.fill(name)
    await expect(page.getByRole('option', { name: `새로 추가: ${name}` })).toBeVisible()
    await input.press('Enter')
  }
  const model = editor.getByRole('combobox', { name: '연결 모델' })
  await model.fill('mock-model')
  await model.press('Escape')
  const inputs = editor.getByRole('combobox', { name: '기대 입력' })
  await inputs.fill('샘플 자료')
  await expect(page.getByRole('option', { name: '새로 추가: 샘플 자료' })).toBeVisible()
  await inputs.press('Enter')
  const outputs = editor.getByRole('combobox', { name: '기대 출력', exact: true })
  await outputs.fill('샘플 결과')
  await expect(page.getByRole('option', { name: '새로 추가: 샘플 결과', exact: true })).toBeVisible()
  await outputs.press('Enter')
  await editor.getByRole('tab', { name: '시험 대화' }).click()
  await expect(editor.getByText('mock-model', { exact: true })).toBeVisible()
  await editor.getByRole('tab', { name: '설정', exact: true }).click()
  await expect(model).toHaveValue('mock-model')
  await expect(editor.getByRole('button', { name: '샘플 자료 제거', exact: true })).toBeVisible()
  await expect(editor.getByRole('button', { name: '샘플 결과 제거', exact: true })).toBeVisible()
  const ownerPicker = editor.getByRole('combobox', { name: '담당자' })
  await ownerPicker.click()
  await expect(page.getByRole('option').first()).toBeVisible()
  await ownerPicker.press('ArrowDown')
  await ownerPicker.press('Enter')
  const creation = page.waitForResponse((response) => response.url().endsWith('/api/assistants') && response.request().method() === 'POST')
  await editor.getByRole('button', { name: '저장', exact: true }).click()
  const created = await creation
  expect(created.status()).toBe(201)
  const id = managedAgent.id = ((await created.json()) as { id: string }).id
  expect(created.request().postDataJSON()).not.toHaveProperty('id')
  expect(created.request().postDataJSON()).toMatchObject({ classifications: [{ level1, level2 }], modelId: 'mock-model', link1: '', expectedInputs: ['샘플 자료'], expectedOutputs: ['샘플 결과'] })
  expect(created.request().postDataJSON()).not.toHaveProperty('level1CodeId')
  expect(created.request().postDataJSON()).not.toHaveProperty('level1')
  expect(id).toMatch(/^a-[a-f0-9]{12}$/)
  await expect(editor).toBeHidden()
  await page.getByRole('button', { name: '분류 코드', exact: true }).click()
  await expect(page.getByRole('heading', { name: '분류 1', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '분류 2', exact: true })).toBeVisible()
  const codeRow = page.getByRole('textbox', { name: `${level1} 이름` }).locator('..')
  await expect(codeRow.getByText('자동', { exact: true })).toBeVisible()
  await expect(codeRow.getByText('사용 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveCount(0)
  // 기존 link1이 있는 레코드는 재정의 표시와 지우기 액션으로 편집한다.
  expect((await managedAgent.api.patch(`/api/assistants/${id}`, { data: { link1: 'https://example.invalid/e2e' } })).ok()).toBe(true)
  await page.goto('/')
  await expect.poll(async () => await page.getByText('E2E 관리 도우미').count()).toBeGreaterThan(0)
  // 편집 액션은 hover/focus-within일 때 표시된다. 먼저 항상 보이는 카드 링크로 진입한다.
  await page.getByRole('link', { name: 'E2E 관리 도우미와 새 대화', exact: true }).focus()
  await expect(page.getByRole('link', { name: 'E2E 관리 도우미 편집', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'E2E 관리 도우미 편집', exact: true }).click()
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('combobox', { name: '연결 모델' })).toHaveValue('mock-model')
  await expect(editor.getByText('기존 링크 재정의 있음', { exact: true })).toBeVisible()
  await editor.getByRole('button', { name: '지우기', exact: true }).click()
  await expect(editor.getByText('기존 링크 재정의 있음', { exact: true })).toHaveCount(0)
  const update = page.waitForResponse(response => response.url().endsWith(`/api/assistants/${id}`) && response.request().method() === 'PATCH')
  await editor.getByRole('button', { name: '저장', exact: true }).click()
  const updated = await update
  expect(updated.ok()).toBe(true)
  expect(updated.request().postDataJSON()).toMatchObject({ link1: '', expectedInputs: ['샘플 자료'], expectedOutputs: ['샘플 결과'] })
  await expect(editor).toBeHidden()
  const table = page.getByRole('table')
  await expect(table.getByRole('textbox')).toHaveCount(0)
  await expect(table.getByText('mock-model', { exact: true })).toBeVisible()
  await expect(table.getByText('E2E 관리 도우미', { exact: true })).toBeVisible()
  await expect(page.getByText(id, { exact: true })).toHaveCount(0) // 목록 로드 전에 순서 편집을 누르면 초안이 비어 draggable 카드가 없다
  await page.getByRole('button', { name: '순서 편집' }).click()
  const cards = page.locator('[draggable="true"]')
  await cards.first().dragTo(cards.last()) // 시드 에이전트를 뒤로 — 새 에이전트가 맨 앞에 오면 병렬 spec들이 assistants[0]으로 집어 삭제가 막힌다
  managedAgent.orderChanged = true
  await page.getByRole('button', { name: '저장', exact: true }).last().click()
  await expect(page.getByText('순서를 저장했습니다')).toBeVisible()
  await page.goto('/settings')
  // 기본 모델은 .env 정본 — 읽기 전용이며 쓰기 DTO에서는 거부한다 (S7 C2).
  await expect(page.locator('form').getByText(managedAgent.defaultModel, { exact: true })).toBeVisible()
  await expect(page.getByLabel('기본 모델')).toHaveCount(0)
  expect((await page.request.patch('/api/settings', { data: { defaultModel: 'e2e-model' } })).status()).toBe(400)
  await page.getByLabel('첨부 개수 한도').fill('7')
  managedAgent.settingsChanged = true
  await page.getByRole('button', { name: '설정 저장' }).click()
  await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).fileMaxPerRequest).toBe(7)
  expect((await (await page.request.get('/api/settings')).json()).defaultModel).toBe(managedAgent.defaultModel)
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
  await owner(page.request)
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
