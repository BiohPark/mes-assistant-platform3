import { expect, test, type Page } from './owui-settings-fixture.js'

// S14-II — 답 글이 멈춘 뒤에도 OpenWebUI가 일하면 그 단계를 보이고, 어느 경로든 응답이 끝나면 중지 버튼·진행 상태가 반드시 정리된다
test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) !== 'live', '가짜 OpenWebUI live 환경에서 실행')

async function setup(page: Page, owuiMode: 'auto' | 'direct') {
  expect((await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password: 'e2e-password-1234' } })).ok()).toBe(true)
  const original = await (await page.request.get('/api/settings')).json() as { owuiTools?: string; owuiMode?: string }
  expect((await page.request.patch('/api/settings', { data: { owuiTools: 'auto', owuiMode } })).ok()).toBe(true)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: `stuck-stop-${owuiMode}-${Date.now()}` } })).json() as { id: string; threadId: string }
  expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { modelId: 'fake-general' } })).ok()).toBe(true)
  const chat = page.getByTestId('chat-message-scroll')
  return {
    task, chat,
    stop: page.getByRole('button', { name: '중지' }),
    status: chat.getByRole('status'),
    footer: chat.getByTestId('reply-progress'),
    send: async (text: string) => {
      await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(text)
      await page.getByRole('button', { name: '전송', exact: true }).click()
    },
    restore: async () => expect((await page.request.patch('/api/settings', { data: { owuiTools: original.owuiTools ?? 'auto', owuiMode: original.owuiMode ?? 'auto' } })).ok()).toBe(true),
  }
}

test('세션 모드: 글이 멈춘 뒤 도구 실행을 단계로 보이고(답 아래에도), 끝나면 중지·상태가 사라진다', async ({ page }) => {
  const s = await setup(page, 'auto')
  try {
    await page.goto(`/c/${s.task.id}`)
    await s.send(`[tool-slow] 도구 ${Date.now()}`)
    await expect(s.chat.getByText(/받은 메시지: \[tool-slow\]/)).toBeVisible()
    // 가짜 도구는 10초 — 결과 없는 function_call이 보이는 동안 단계가 바뀐다
    await expect(s.status).toHaveText('도구 실행: fake_tool', { timeout: 10_000 })
    await expect(s.footer).toContainText('도구 실행: fake_tool')
    await expect(s.stop).toBeVisible()
    // 멈춘 채 작업 목록이 살아 있으면 OpenWebUI에서 작업 중 — 무응답이 아니라 일하는 중이다
    await expect(s.status).toHaveText('OpenWebUI에서 작업 중 · 도구 실행: fake_tool', { timeout: 10_000 })
    await expect(s.footer).toContainText(/OpenWebUI에서 작업 중 · 도구 실행: fake_tool.*초째/)
    await expect(s.chat.getByText(/\[tool: fake_tool 완료\]/)).toBeVisible({ timeout: 20_000 })
    await expect(s.stop).toBeHidden()
    await expect(s.status).toHaveCount(0)
    await expect(s.footer).toHaveCount(0)
    await expect(page.getByRole('button', { name: '전송', exact: true })).toBeVisible()
  } finally { await s.restore() }
})

test('세션 모드: OpenWebUI가 done 없이 작업을 끝내도 무응답 제한(5분)을 기다리지 않고 정리한다', async ({ page }) => {
  const s = await setup(page, 'auto')
  try {
    await page.goto(`/c/${s.task.id}`)
    await s.send(`[done-missing] 끝 ${Date.now()}`)
    await expect(s.chat.getByText(/받은 메시지: \[done-missing\]/)).toBeVisible()
    await expect(s.stop).toBeHidden({ timeout: 15_000 })
    await expect(s.status).toHaveCount(0)
    const messages = await (await page.request.get(`/api/threads/${s.task.threadId}/messages`)).json() as Array<{ role: string; status: string; requestId?: string }>
    const reply = messages.find(row => row.role === 'assistant')!
    expect(reply.status).toBe('done')
    expect(await (await page.request.get(`/api/requests/${reply.requestId}`)).json()).toMatchObject({ status: 'succeeded' })
  } finally { await s.restore() }
})

test('직접 모드: [DONE] 뒤 OpenWebUI가 연결을 붙잡아도(30초) 바로 끝낸다', async ({ page }) => {
  const s = await setup(page, 'direct')
  try {
    await page.goto(`/c/${s.task.id}`)
    await s.send(`[done-linger] 오래 ${Date.now()}`)
    await expect(s.chat.getByText(/받은 메시지: \[done-linger\]/)).toBeVisible()
    await expect(s.stop).toBeHidden({ timeout: 10_000 })
    await expect(s.status).toHaveCount(0)
  } finally { await s.restore() }
})

test('실시간 연결 차단: 이벤트 SSE가 막히고 응답 스트림이 끝 이벤트 없이 끊겨도 서버 상태로 화면을 정리한다', async ({ page }) => {
  const s = await setup(page, 'auto')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    // 프록시가 /api/events를 막고, 답 스트림은 started 뒤를 붙잡았다가 끊는 상황
    await page.route('**/api/events', route => route.abort())
    await page.route('**/api/threads/*/requests', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      const body = await response.text()
      const started = body.split('\n\n').find(frame => frame.startsWith('event: started'))
      await route.fulfill({ status: response.status(), contentType: 'text/event-stream; charset=utf-8', body: started ? `${started}\n\n` : '' })
    })
    await page.goto(`/c/${s.task.id}`)
    await s.send(`차단된 실시간 연결 ${Date.now()}`)
    await expect(s.chat.getByText(/받은 메시지: 차단된 실시간 연결/)).toBeVisible({ timeout: 15_000 })
    await expect(s.stop).toBeHidden()
    await expect(s.status).toHaveCount(0)
    await expect(page.getByText('스트림 연결이 끊겼습니다')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await s.restore() }
})
