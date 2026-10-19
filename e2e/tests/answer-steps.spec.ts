import { expect, test } from './owui-settings-fixture.js'
type Message = { id: string; role: string; status: string; requestId?: string; steps?: Array<{ type: string }> }
const live = (process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) === 'live'
const LABEL = { full: '도구·코드까지 전체', brief: '코드·쉘 실행 제외', answer: '답변만' } as const
/** 토글은 전체 → 실행 제외 → 답변만 순서로 돈다 — 원하는 모드가 될 때까지 누른다(최대 2번) */
async function setDetail(page: import('@playwright/test').Page, detail: keyof typeof LABEL) {
  const toggle = page.getByTestId('answer-detail-toggle')
  for (let i = 0; i < 3 && (await toggle.textContent()) !== LABEL[detail]; i++) await toggle.click()
  await expect(toggle).toHaveText(LABEL[detail])
}

test('R1: ordered steps, persisted user detail, matching copy and reference attachment detail', async ({ page, request }) => {
  test.skip(!live, 'Requires fake OpenWebUI session output')
  // 단계 시나리오는 세션 모드 output에만 있다 — 다른 spec이 남긴 전역 owuiMode(direct 등)에 기대지 않고 고정한다
  expect((await request.post('/api/auth/login', { data: { loginId: 'dev-owner', password: 'e2e-password-1234' } })).ok()).toBe(true)
  const original = await (await request.get('/api/settings')).json() as { owuiTools?: string; owuiMode?: string }
  expect((await request.patch('/api/settings', { data: { owuiTools: 'auto', owuiMode: 'session' } })).ok()).toBe(true)
  try {
    await page.goto('/signup')
    await page.getByLabel('ID').fill(`e2e-steps-${Date.now()}`)
    await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
    await page.getByLabel('이름').fill('단계 사용자')
    await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
    await page.getByRole('button', { name: '회원가입' }).click()
    await expect(page).toHaveURL(/\/$/)
    const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
    const tag = `steps-${Date.now()}`
    const create = async (title: string) => {
      const response = await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title, tags: [tag] } })
      expect(response.ok()).toBe(true)
      return await response.json() as { id: string; threadId: string }
    }
    const source = await create('답변 단계 원본')
    await page.goto(`/c/${source.id}`)
    const toggle = page.getByTestId('answer-detail-toggle')
    // 기본은 ② 코드·쉘 실행 제외, 누르면 ③ 답변만 → ① 전체
    await expect(toggle).toHaveText(LABEL.brief)
    await toggle.click()
    await expect(toggle).toHaveText(LABEL.answer)
    await toggle.click()
    await expect(toggle).toHaveText(LABEL.full)
    await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill('[reasoning] [steps] 단계 순서')
    await page.getByRole('button', { name: '전송', exact: true }).click()
    const read = async () => await (await page.request.get(`/api/threads/${source.threadId}/messages`)).json() as Message[]
    await expect.poll(async () => (await read()).findLast(m => m.role === 'assistant')?.status).toBe('done')
    const reply = (await read()).findLast(m => m.role === 'assistant')!
    expect(reply.steps?.map(s => s.type)).toEqual(['reasoning', 'text', 'tool', 'text'])
    const bubble = page.locator(`[data-message-id="${reply.id}"]`)
    const kinds = async () => await bubble.locator('[data-answer-step]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-answer-step')))
    await expect(bubble.locator('[data-answer-step]')).toHaveCount(4)
    expect(await kinds()).toEqual(['reasoning', 'text', 'tool', 'text'])
    await expect(bubble.locator('[data-answer-step="tool"] summary')).toHaveText('도구 사용 · fake_tool · raw step input · 완료')
    await bubble.locator('[data-answer-step="tool"] summary').click()
    await expect(bubble.getByText('raw step result')).toBeVisible()
    await page.reload()
    await expect(toggle).toHaveText(LABEL.full)
    await expect(bubble.locator('[data-answer-step="tool"]')).toHaveCount(1)
    // ② 실행 제외: 생각과 도구 헤더는 남고 입력·결과는 숨는다
    await toggle.click()
    await expect(toggle).toHaveText(LABEL.brief)
    expect(await kinds()).toEqual(['reasoning', 'text', 'tool', 'text'])
    await expect(bubble.locator('[data-answer-step="tool"]')).toHaveText('도구 사용 · fake_tool · 완료')
    await expect(bubble.getByText('raw step input')).toHaveCount(0)
    await expect(bubble.getByText('raw step result')).toHaveCount(0)
    // ③ 답변만: 생각도 숨는다
    await toggle.click()
    await expect(toggle).toHaveText(LABEL.answer)
    await expect(bubble.locator('[data-answer-step]')).toHaveCount(2)
    expect(await kinds()).toEqual(['text', 'text'])
    await page.reload()
    await expect(toggle).toHaveText(LABEL.answer)
    for (const detail of ['brief', 'full', 'answer'] as const) {
      const target = await create(`참고 대화 ${detail}`)
      const selected = await page.request.put(`/api/tasks/${target.id}/conversation-inputs/${source.id}`, { data: { mode: 'full' } })
      expect(selected.ok()).toBe(true)
      await page.goto(`/c/${target.id}`)
      await setDetail(page, detail)
      const marker = `R1-${detail}-${target.id}`
      const estimate = await (await page.request.post(`/api/threads/${target.threadId}/requests/estimate`, { data: { draft: marker, detail } })).json() as { bytes: number }
      await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(marker)
      await page.getByRole('button', { name: '전송', exact: true }).click()
      const rows = async () => await (await page.request.get(`/api/threads/${target.threadId}/messages`)).json() as Message[]
      await expect.poll(async () => (await rows()).findLast(m => m.role === 'assistant')?.status).toBe('done')
      const sent = (await rows()).findLast(m => m.role === 'assistant')!
      const record = await (await page.request.get(`/api/requests/${sent.requestId}`)).json() as { bytes: number }
      expect(record.bytes).toBe(estimate.bytes)
      const snapshot = await (await page.request.get(`/api/requests/${sent.requestId}/snapshot`)).json() as { messages: Array<{ content: string }> }
      const reference = snapshot.messages[0]!.content
      expect(reference.includes('PRIVATE_REASONING')).toBe(detail !== 'answer')
      expect(reference.includes('[도구 사용: fake_tool')).toBe(detail !== 'answer')
      expect(reference.includes('raw step result')).toBe(detail === 'full')
      expect(reference.includes('raw step input')).toBe(detail === 'full')
    }
  } finally {
    expect((await request.patch('/api/settings', { data: { owuiTools: original.owuiTools ?? 'auto', owuiMode: original.owuiMode ?? 'auto' } })).ok()).toBe(true)
  }
})

test('R1-2: OpenWebUI <details> content becomes ordered steps and the raw response is viewable beside the parse', async ({ page, request }) => {
  test.skip(!live, 'Requires fake OpenWebUI session output')
  expect((await request.post('/api/auth/login', { data: { loginId: 'dev-owner', password: 'e2e-password-1234' } })).ok()).toBe(true)
  const original = await (await request.get('/api/settings')).json() as { owuiTools?: string; owuiMode?: string }
  expect((await request.patch('/api/settings', { data: { owuiTools: 'auto', owuiMode: 'session' } })).ok()).toBe(true)
  try {
    await page.goto('/signup')
    await page.getByLabel('ID').fill(`e2e-details-${Date.now()}`)
    await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
    await page.getByLabel('이름').fill('원문 사용자')
    await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
    await page.getByRole('button', { name: '회원가입' }).click()
    await expect(page).toHaveURL(/\/$/)
    const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
    const created = await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: 'details 형식', assigneeIds: [] } }) // 요청자만, 담당자 없음
    expect(created.ok()).toBe(true)
    const task = await created.json() as { id: string; threadId: string }
    await page.goto(`/c/${task.id}`)
    await setDetail(page, 'full')
    await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill('[details] 형식 확인')
    await page.getByRole('button', { name: '전송', exact: true }).click()
    const read = async () => await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Array<Message & { content: string }>
    await expect.poll(async () => (await read()).findLast(m => m.role === 'assistant')?.status).toBe('done')
    const reply = (await read()).findLast(m => m.role === 'assistant')!
    expect(reply.steps?.map(s => s.type)).toEqual(['reasoning', 'text', 'code', 'tool', 'text'])
    expect(reply.content).not.toContain('<details')
    const bubble = page.locator(`[data-message-id="${reply.id}"]`)
    expect(await bubble.locator('[data-answer-step]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-answer-step')))).toEqual(['reasoning', 'text', 'code', 'tool', 'text'])
    // 끝난 생각은 접혀 있다 — 내용이 생각 블록에 담겼는지만 본다
    await expect(bubble.locator('[data-answer-step="reasoning"]')).toContainText('PRIVATE_REASONING: details thought')
    await expect(bubble.locator('strong', { hasText: 'details answer' })).toBeVisible()
    await expect(bubble.getByText('<details')).toHaveCount(0)
    await setDetail(page, 'brief')
    await expect(bubble.locator('[data-answer-step="code"]')).toHaveText('코드 실행 · 완료')
    await expect(bubble.getByText('details output')).toHaveCount(0)
    // 요청자(담당자 아님)에게는 원문 보기가 없다 — SO·담당자만
    await bubble.getByRole('button', { name: '사용한 자료', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '사용한 자료' })
    await expect(dialog.getByText(/bytes/).first()).toBeVisible()
    await expect(dialog.getByRole('button', { name: '응답 원문 보기' })).toHaveCount(0)
    expect((await page.request.get(`/api/requests/${reply.requestId}/response`)).status()).toBe(403)
    await page.keyboard.press('Escape')
    expect((await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password: 'e2e-password-1234' } })).ok()).toBe(true)
    await page.reload()
    await bubble.getByRole('button', { name: '사용한 자료', exact: true }).click()
    await dialog.getByRole('button', { name: '응답 원문 보기' }).click()
    const raw = dialog.getByTestId('raw-response-json')
    await expect(raw).toContainText('type=\\"code_interpreter\\"')
    await expect(raw).toContainText('"mode": "session"')
    await expect(dialog.getByRole('heading', { name: '파싱된 steps' })).toBeVisible()
    await expect(dialog.getByTestId('response-body')).toContainText('**details answer**')
    await expect(dialog.getByTestId('response-body')).not.toContainText('<details')
    await expect(dialog.getByRole('button', { name: 'JSON 복사' })).toBeVisible()
  } finally {
    expect((await request.patch('/api/settings', { data: { owuiTools: original.owuiTools ?? 'auto', owuiMode: original.owuiMode ?? 'auto' } })).ok()).toBe(true)
  }
})
