import { expect, test } from '@playwright/test'

const password = 'e2e-password-1234'
async function setup(page: import('@playwright/test').Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-request-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string; threadId: string }
  await page.goto(`/c/${task.id}`)
  return task
}

test('S6 크기 초과 실패가 기록되고 입력창을 다시 사용할 수 있다', async ({ page }) => {
  const task = await setup(page)
  await page.getByRole('button', { name: '팀 의견 (AI 미전송)' }).click()
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('x'.repeat(270_000))
  // 트레이는 초과 전송을 막으므로 서버의 기록형 실패 계약은 API 경로에서 확인한다.
  const response = await page.request.post(`/api/threads/${task.threadId}/requests`, {
    headers: { 'Idempotency-Key': `over-${Date.now()}` }, data: { content: 'x'.repeat(270_000) },
  })
  expect(response.status(), `요청 POST 응답 ${response.status()} ${await response.text().catch(() => '')}`.slice(0, 300)).toBe(201) // SSE 시작은 201
  await expect(page.getByText(/요청 크기 한도 초과/).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('textbox', { name: '팀 의견 입력' })).toBeEnabled()
  const messages = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Array<{ requestId?: string; status: string }>
  expect(messages.at(-1)).toMatchObject({ status: 'error', requestId: expect.any(String) })
})

test('S7 두 탭의 동시 전송 중 하나만 시작한다', async ({ page, context }) => {
  const task = await setup(page)
  const second = await context.newPage()
  await second.goto(`/c/${task.id}`)
  const calls = await Promise.all([page, second].map((tab, index) => tab.request.post(`/api/threads/${task.threadId}/requests`, {
    headers: { 'Idempotency-Key': `race-${Date.now()}-${index}` }, data: { content: `동시 요청 ${index}` },
  })))
  expect(calls.map((response) => response.status()).sort()).toEqual([201, 409])
  await second.close()
})

test('S8 Mock 답변에 사용한 자료와 요청 기록을 표시한다', async ({ page }) => {
  test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) === 'live', 'Mock 전용 시나리오 — live 모드에서는 건너뜀')
  await setup(page)
  await page.getByRole('button', { name: '팀 의견 (AI 미전송)' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'e2e-input.txt', mimeType: 'text/plain', buffer: Buffer.from('참고 입력') })
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('자료를 사용해 답변해 줘')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByText(/사용한 자료.*Mock 대역 표시/).first()).toBeVisible()
  // 답변 본문이 보여도 요청 기록은 종료 전이 뒤에 확정된다 — 중지 버튼이 사라질 때(응답 종료)까지 기다린 뒤 기록을 연다
  await expect(page.getByRole('button', { name: '중지' })).toBeHidden()
  await page.getByRole('button', { name: '사용한 자료' }).click()
  await expect(page.getByRole('dialog')).toContainText('e2e-input.txt')
  await expect(page.getByRole('link', { name: '원본 JSON 다운로드' })).toHaveAttribute('href', /\/snapshot$/)
})
