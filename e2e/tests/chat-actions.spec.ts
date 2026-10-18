import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

test.beforeEach(() => {
  test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) === 'live', '메시지 동작은 결정적인 Mock 응답으로 검증한다')
})
const question = '**자료를 검토해 줘**\n\n- 첫 질문'
type StoredMessage = { id: string; role: string; content: string; attachmentIds: string[]; requestId?: string; status: string }
async function setup(page: Page) {
  const id = `actions-${randomUUID().slice(0, 16)}`
  await page.goto('/signup')
  await page.getByLabel('ID').fill(id)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByLabel('이름').fill(id)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  expect(assistants.length).toBeGreaterThan(0)
  const created = await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })
  expect(created.ok()).toBe(true)
  const task = await created.json() as { id: string; threadId: string }
  expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { modelId: 'fake-general' } })).ok()).toBe(true)
  await page.goto(`/c/${task.id}`)
  await page.locator('[data-tour="composer"] input[type="file"]').setInputFiles({ name: `${id}-original.txt`, mimeType: 'text/plain', buffer: Buffer.from('원래 첨부') })
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(question)
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByRole('button', { name: '사용한 자료' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: '중지' })).toBeHidden()
  const history = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as StoredMessage[]
  return { task, history, original: history.find(item => item.role === 'user')! }
}
function bubble(page: Page, id: string) { return page.locator(`[data-message-id="${id}"]`) }
async function prefill(page: Page, id: string) {
  await bubble(page, id).hover()
  await bubble(page, id).getByRole('button', { name: '다시 묻기', exact: true }).click()
}

test('프리필은 일반 입력과 추정·전송 경로가 같고 원래 문답을 유지한다', async ({ page }) => {
  const { task, history, original } = await setup(page)
  const input = page.getByRole('textbox', { name: 'AI 요청 입력' })
  await page.locator('[data-tour="composer"] input[type="file"]').setInputFiles({ name: 'current.txt', mimeType: 'text/plain', buffer: Buffer.from('현재 첨부') })
  await input.fill(question)
  // S14: 첨부는 입력창 칩 한 줄(크기는 한도 근처에서만 보인다)
  const chips = page.getByRole('list', { name: '첨부', exact: true })
  await expect(chips).toContainText('current.txt')
  const manualChips = await chips.innerText()
  await input.fill('보호할 초안')
  await prefill(page, original.id)
  await expect(page.getByRole('dialog')).toContainText('텍스트만 바꿉니다')
  await page.getByRole('button', { name: '취소', exact: true }).click()
  await expect(input).toHaveValue('보호할 초안')
  await prefill(page, original.id)
  await page.getByRole('button', { name: '텍스트 바꾸기' }).click()
  await expect(input).toHaveValue(question)
  await expect(input).toBeFocused()
  await expect(page.getByText('현재 자료·모델로 새 요청, 이전 문답 포함')).toBeVisible()
  expect(await chips.innerText()).toBe(manualChips)
  await expect(page.getByRole('button', { name: /첨부 빼기$/ })).toHaveCount(1) // 현재 첨부 대기 유지
  const sentPromise = page.waitForRequest(request => request.url().endsWith(`/threads/${task.threadId}/requests`) && request.method() === 'POST')
  const estimatePromise = page.waitForRequest(request => request.url().endsWith('/requests/estimate') && !!request.postDataJSON()?.attachmentIds)
  await page.getByRole('button', { name: '전송', exact: true }).click()
  const [sent, estimate] = await Promise.all([sentPromise, estimatePromise])
  const body = sent.postDataJSON() as { content: string; attachmentIds: string[]; oneShotFileIds: string[] }
  expect(body.content).toBe(question)
  expect(body.attachmentIds).toHaveLength(1)
  expect(body.attachmentIds).not.toEqual(original.attachmentIds)
  expect(body.oneShotFileIds).toEqual([])
  expect(estimate.postDataJSON()).toEqual({ draft: question, attachmentIds: body.attachmentIds, oneShotFileIds: [] })
  expect(sent.headers()['idempotency-key']).toBeTruthy()
  await expect(page.getByRole('button', { name: '사용한 자료' })).toHaveCount(2)
  await expect(page.getByRole('button', { name: '중지' })).toBeHidden()
  const after = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as StoredMessage[]
  expect(after.slice(0, history.length)).toEqual(history)
  expect(after.filter(item => item.role === 'user')).toHaveLength(2)
})

test('팀 의견 모드·현재 첨부는 프리필 뒤에도 유지되며 AI 요청을 보내지 않는다', async ({ page }) => {
  const { task, original } = await setup(page)
  let aiPosts = 0
  page.on('request', request => { if (request.url().endsWith(`/threads/${task.threadId}/requests`) && request.method() === 'POST') aiPosts++ })
  await page.getByRole('button', { name: '팀 의견 (AI 미전송)' }).click()
  await page.locator('[data-tour="composer"] input[type="file"]').setInputFiles({ name: 'team-current.txt', mimeType: 'text/plain', buffer: Buffer.from('팀 첨부') })
  await prefill(page, original.id)
  await expect(page.getByRole('textbox', { name: '팀 의견 입력' })).toHaveValue(question)
  await expect(page.getByText('team-current.txt', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /첨부 빼기$/ })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /입력으로 고정|이번 메시지만/ })).toHaveCount(0)
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '팀 의견 입력' })).toBeEmpty()
  // 입력창은 즉시 비워지므로 서버에 팀 의견이 저장될 때까지 별도로 기다린다.
  const messages = async () => (await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json()) as Array<StoredMessage & { kind?: string }>
  await expect.poll(async () => (await messages()).at(-1)).toMatchObject({ kind: 'discussion', content: question, attachmentIds: [expect.any(String)] })
  const history = await messages()
  expect(history.at(-1)!.attachmentIds).not.toEqual(original.attachmentIds)
  expect(aiPosts).toBe(0)
  const storedTask = await (await page.request.get(`/api/tasks/${task.id}`)).json() as { inputs: Array<{ fileId: string }> }
  expect(storedTask.inputs.map(input => input.fileId)).not.toContain(history.at(-1)!.attachmentIds[0])
})

test('409 충돌과 중복 조작은 초안을 보존하고 동일 키로 재전송한다', async ({ page }) => {
  const { task, history, original } = await setup(page)
  await prefill(page, original.id)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const attempts: Array<{ key?: string; body: unknown }> = []
  await page.route(`**/api/threads/${task.threadId}/requests`, async route => {
    attempts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() })
    if (attempts.length === 1) await gate
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'REQUEST_ACTIVE', message: '이미 응답 중입니다' }) })
  })
  const input = page.getByRole('textbox', { name: 'AI 요청 입력' })
  // Enter has no actionability wait: a background estimate refetch can block it even
  // immediately after toBeEnabled. Retry until the gated first POST is observed.
  await expect(async () => {
    if (attempts.length === 0) await input.press('Enter')
    expect(attempts).toHaveLength(1)
  }).toPass({ timeout: 15_000 })
  await input.dispatchEvent('keydown', { key: 'Enter' })
  expect(attempts).toHaveLength(1)
  await expect(bubble(page, original.id).getByRole('button', { name: '다시 묻기' })).toBeDisabled()
  release()
  await expect(page.getByText('전송하지 못했습니다.', { exact: true })).toBeVisible()
  await page.getByRole('listitem').filter({ hasText: '전송하지 못했습니다.' }).getByRole('button', { name: 'Close toast', exact: true }).click()
  expect(attempts).toHaveLength(2) // 기존 useChat의 네트워크 재시도 1회
  expect(attempts[0]).toEqual(attempts[1])
  expect(attempts[0]!.key).toBeTruthy()
  await expect(input).toHaveValue(question)
  const unchanged = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json()
  expect(unchanged).toEqual(history)
  await page.unroute(`**/api/threads/${task.threadId}/requests`)
  const sentPromise = page.waitForRequest(request => request.url().endsWith(`/threads/${task.threadId}/requests`) && request.method() === 'POST')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  const sent = await sentPromise
  expect(sent.headers()['idempotency-key']).toBe(attempts[0]!.key)
  expect(sent.postDataJSON()).toEqual(attempts[0]!.body)
  await expect(page.getByRole('button', { name: '사용한 자료' })).toHaveCount(2)
})

test('모바일 메뉴·목차는 키보드로 열고 완료 대화에서는 다시 묻기를 막는다', async ({ page }) => {
  const { task, original } = await setup(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  const trigger = bubble(page, original.id).getByRole('button', { name: '메시지 메뉴' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: '복사' })).toBeVisible()
  await page.getByRole('menuitem', { name: '다시 묻기' }).click()
  await expect(page.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue(question)
  await expect(page.getByRole('textbox', { name: 'AI 요청 입력' })).toBeFocused()
  await page.getByRole('button', { name: '질문 목차' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: '질문 목차' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(bubble(page, original.id)).toBeFocused()
  const completed = await page.request.post(`/api/tasks/${task.id}/status`, { data: { status: 'done', reason: '메시지 동작 완료 테스트' } })
  expect(completed.ok()).toBe(true)
  await page.reload()
  await bubble(page, original.id).getByRole('button', { name: '메시지 메뉴' }).click()
  await expect(page.getByRole('menuitem', { name: '다시 묻기' })).toHaveAttribute('data-disabled', '')
})
