import { expect, test } from './owui-settings-fixture.js'
type Message = { id: string; role: string; status: string; requestId?: string; steps?: Array<{ type: string }> }
const live = (process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) === 'live'

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
    await expect(toggle).toHaveText('생각·답변만')
    await toggle.click()
    await expect(toggle).toHaveText('도구까지 전체')
    await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill('[reasoning] [steps] 단계 순서')
    await page.getByRole('button', { name: '전송', exact: true }).click()
    const read = async () => await (await page.request.get(`/api/threads/${source.threadId}/messages`)).json() as Message[]
    await expect.poll(async () => (await read()).findLast(m => m.role === 'assistant')?.status).toBe('done')
    const reply = (await read()).findLast(m => m.role === 'assistant')!
    expect(reply.steps?.map(s => s.type)).toEqual(['reasoning', 'text', 'tool', 'text'])
    const bubble = page.locator(`[data-message-id="${reply.id}"]`)
    await expect(bubble.locator('[data-answer-step]')).toHaveCount(4)
    expect(await bubble.locator('[data-answer-step]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-answer-step')))).toEqual(['reasoning', 'text', 'tool', 'text'])
    await expect(bubble.locator('[data-answer-step="tool"] summary')).toHaveText('도구 사용 · fake_tool · raw step input · 완료')
    await bubble.locator('[data-answer-step="tool"] summary').click()
    await expect(bubble.getByText('raw step result')).toBeVisible()
    await page.reload()
    await expect(toggle).toHaveText('도구까지 전체')
    await expect(bubble.locator('[data-answer-step="tool"]')).toHaveCount(1)
    await toggle.click()
    await expect(bubble.locator('[data-answer-step="tool"]')).toHaveCount(0)
    await page.reload()
    await expect(toggle).toHaveText('생각·답변만')
    for (const detail of ['brief', 'full'] as const) {
      const target = await create(`참고 대화 ${detail}`)
      const selected = await page.request.put(`/api/tasks/${target.id}/conversation-inputs/${source.id}`, { data: { mode: 'full' } })
      expect(selected.ok()).toBe(true)
      await page.goto(`/c/${target.id}`)
      if (detail === 'full') await page.getByTestId('answer-detail-toggle').click()
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
      expect(reference).toContain('PRIVATE_REASONING')
      expect(reference.includes('raw step result')).toBe(detail === 'full')
      expect(reference.includes('raw step input')).toBe(detail === 'full')
    }
  } finally {
    expect((await request.patch('/api/settings', { data: { owuiTools: original.owuiTools ?? 'auto', owuiMode: original.owuiMode ?? 'auto' } })).ok()).toBe(true)
  }
})
