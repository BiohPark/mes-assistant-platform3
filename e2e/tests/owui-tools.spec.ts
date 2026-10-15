import { expect, test, type Page } from '@playwright/test'

test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) !== 'live', '가짜 OpenWebUI live 환경에서 실행')
const fake = `http://127.0.0.1:${process.env.E2E_FAKE_OWUI_PORT ?? '3102'}`

test('OpenWebUI 자동 도구 전달·400 폴백·끔: 보낸 것=본 것, 한 요청·한 답변', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password: 'e2e-password-1234' } })
  expect(login.ok()).toBe(true)
  const original = await (await page.request.get('/api/settings')).json()
  const rejection = await (await page.request.get(`${fake}/__e2e/tool-ids`)).json()
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const toggle = async (reject: boolean) => expect((await page.request.post(`${fake}/__e2e/tool-ids`, { data: { reject } })).ok()).toBe(true)
  try {
    for (const mode of ['tools', 'fallback', 'basic'] as const) {
      await toggle(mode === 'fallback')
      // 기존 스트리밍 방식(direct)의 도구 전달을 본다 — 세션 모드는 아래 테스트(같은 파일이라 순서대로 돈다)
      expect((await page.request.patch('/api/settings', { data: { owuiTools: mode === 'basic' ? 'off' : 'auto', owuiMode: 'direct' } })).ok()).toBe(true)
      const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: `owui-${mode}` } })).json() as { id: string; threadId: string }
      // 작업 모델을 지정해 에이전트 매핑·전역 모델에 영향받지 않는다.
      expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { modelId: 'fake-general' } })).ok()).toBe(true)
      const prompt = `owui-tools-${mode}-${Date.now()} https://example.com/read`
      await page.goto(`/c/${task.id}`)
      const estimate = await (await page.request.post(`/api/threads/${task.threadId}/requests/estimate`, { data: { draft: prompt } })).json()
      await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(prompt)
      await page.getByRole('button', { name: '전송', exact: true }).click()
      await expect(page.getByText(/가짜 OpenWebUI.*받은 메시지/).first()).toBeVisible()
      await expect.poll(async () => {
        const messages = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Array<{ role: string; status: string; requestId?: string }>
        return messages.find(row => row.role === 'assistant')?.status
      }).toBe('done')
      const messages = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Array<{ role: string; requestId?: string }>
      expect(messages.filter(row => row.role === 'assistant')).toHaveLength(1)
      expect(messages.filter(row => row.role === 'user')).toHaveLength(1)
      const id = messages.find(row => row.role === 'assistant')!.requestId!
      const record = await (await page.request.get(`/api/requests/${id}`)).json()
      expect(record).toMatchObject({ status: 'succeeded', owuiTools: { mode }, bytes: estimate.bytes })
      const snapshot = await (await page.request.get(`/api/requests/${id}/snapshot`)).json()
      const captured = await (await page.request.get(`${fake}/__e2e/requests`)).json() as Array<Record<string, unknown>>
      const attempts = captured.filter(row => JSON.stringify(row.messages).includes(prompt))
      expect(attempts).toHaveLength(mode === 'fallback' ? 2 : 1)
      expect(snapshot.messages).toEqual(attempts.at(-1)!.messages)
      await page.getByRole('button', { name: '사용한 자료' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText({ tools: '도구 전달', fallback: '폴백 (기본 방식)', basic: '기본 방식' }[mode])
      if (mode === 'tools') {
        expect(snapshot).toMatchObject({ tool_ids: ['fake_tool'], features: { web_search: true }, params: { function_calling: 'legacy' } })
        expect(record.owuiTools).toMatchObject({ tool_ids: snapshot.tool_ids, features: snapshot.features })
        await expect(dialog).toContainText('fake_tool')
        await expect(dialog).toContainText('web_search')
      } else {
        for (const key of ['tool_ids', 'features', 'params']) { expect(snapshot).not.toHaveProperty(key); expect(attempts.at(-1)).not.toHaveProperty(key) }
        await expect(dialog).not.toContainText('fake_tool')
      }
      if (mode === 'fallback') expect(attempts[0]).toMatchObject({ tool_ids: ['fake_tool'], features: { web_search: true } })
      await page.keyboard.press('Escape')
    }
  } finally {
    await toggle(rejection.reject)
    expect((await page.request.patch('/api/settings', { data: { owuiTools: original.owuiTools ?? 'auto', owuiMode: original.owuiMode ?? 'auto' } })).ok()).toBe(true)
  }
})

/** 세션 모드(S12) — 가짜 OpenWebUI가 v0.12처럼 chat_id만 돌려주고 채팅 GET으로 진행을 보여 준다 */
async function sessionSetup(page: Page) {
  expect((await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password: 'e2e-password-1234' } })).ok()).toBe(true)
  const original = await (await page.request.get('/api/settings')).json() as { owuiTools?: string; owuiMode?: string }
  expect((await page.request.patch('/api/settings', { data: { owuiTools: 'auto', owuiMode: 'auto' } })).ok()).toBe(true)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const conversation = async (title: string) => {
    const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title } })).json() as { id: string; threadId: string }
    expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { modelId: 'fake-general' } })).ok()).toBe(true)
    await page.goto(`/c/${task.id}`)
    return task
  }
  const send = async (text: string) => {
    await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(text)
    await page.getByRole('button', { name: '전송', exact: true }).click()
  }
  const reply = async (threadId: string, status: string) => {
    await expect.poll(async () => (await (await page.request.get(`/api/threads/${threadId}/messages`)).json() as Array<{ role: string; status: string }>).find(row => row.role === 'assistant')?.status).toBe(status)
    return (await (await page.request.get(`/api/threads/${threadId}/messages`)).json() as Array<{ role: string; requestId?: string }>).find(row => row.role === 'assistant')!.requestId!
  }
  const captured = async (marker: string) => (await (await page.request.get(`${fake}/__e2e/requests`)).json() as Array<Record<string, unknown>>).filter(row => JSON.stringify(row.messages).includes(marker))
  const sessions = async () => await (await page.request.get(`${fake}/__e2e/sessions`)).json() as { active: string[]; stopped: string[]; deleted: string[] }
  const restore = async () => expect((await page.request.patch('/api/settings', { data: { owuiTools: original.owuiTools ?? 'auto', owuiMode: original.owuiMode ?? 'auto' } })).ok()).toBe(true)
  return { conversation, send, reply, captured, sessions, restore }
}

test('OpenWebUI 세션 모드: URL 읽기 상태가 보이고, 보낸 것=본 것이며, 끝나면 OpenWebUI 채팅을 지운다', async ({ page }) => {
  const s = await sessionSetup(page)
  try {
    const task = await s.conversation('owui-session-url')
    const prompt = `https://example.com/doc-${Date.now()} 요약해 줘`
    const estimate = await (await page.request.post(`/api/threads/${task.threadId}/requests/estimate`, { data: { draft: prompt } })).json() as { bytes: number }
    await s.send(prompt)
    await expect(page.getByText(/URL 읽는 중: https:\/\/example\.com\/doc-/).first()).toBeVisible()
    await expect(page.getByText(/\[fetched: https:\/\/example\.com\/doc-/).first()).toBeVisible()
    const id = await s.reply(task.threadId, 'done')
    expect(await (await page.request.get(`/api/requests/${id}`)).json()).toMatchObject({ status: 'succeeded', owuiTools: { mode: 'tools' }, bytes: estimate.bytes })
    const snapshot = await (await page.request.get(`/api/requests/${id}/snapshot`)).json() as Record<string, unknown>
    expect(snapshot).toMatchObject({ mode: 'session', chat_id: expect.any(String), tool_ids: ['fake_tool'], features: { web_search: true }, params: { tool_approval_mode: 'full' } })
    const attempts = await s.captured(prompt)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ session_id: expect.any(String), parent_id: null })
    expect(attempts[0]).not.toHaveProperty('user_message')
    expect(snapshot.messages).toEqual(attempts[0]!.messages)
    await expect.poll(async () => (await s.sessions()).deleted).toContain(snapshot.chat_id)
  } finally { await s.restore() }
})

test('OpenWebUI 세션 모드: 작업 오류는 실패로, 생성 거부는 기존 방식 한 번으로, 중지는 OpenWebUI 작업 중지로 이어진다', async ({ page }) => {
  const s = await sessionSetup(page)
  try {
    const failed = await s.conversation('owui-session-error')
    await s.send(`[error] 세션 오류 ${Date.now()}`)
    await expect(page.getByText(/OpenWebUI 작업 실패/).first()).toBeVisible()
    expect(await (await page.request.get(`/api/requests/${await s.reply(failed.threadId, 'error')}`)).json()).toMatchObject({ status: 'failed' })

    const fallback = await s.conversation('owui-session-fallback')
    const prompt = `[session-400] 폴백 ${Date.now()}`
    await s.send(prompt)
    await expect(page.getByText(/가짜 OpenWebUI.*받은 메시지: \[session-400\]/).first()).toBeVisible()
    const id = await s.reply(fallback.threadId, 'done')
    const snapshot = await (await page.request.get(`/api/requests/${id}/snapshot`)).json() as Record<string, unknown>
    expect(snapshot).toMatchObject({ mode: 'direct' })
    expect(snapshot).not.toHaveProperty('chat_id')
    const attempts = await s.captured(prompt)
    expect(attempts.map(row => 'session_id' in row)).toEqual([true, false])
    expect(snapshot.messages).toEqual(attempts[1]!.messages)

    const before = await s.sessions()
    await s.conversation('owui-session-stop')
    await s.send(`[delay] 중지 ${Date.now()}`)
    await expect(page.getByText('작업 대기 중').first()).toBeVisible()
    await page.getByRole('button', { name: '중지' }).click()
    await expect.poll(async () => (await s.sessions()).stopped.length).toBe(before.stopped.length + 1)
    const after = await s.sessions()
    expect(after.deleted).toContain(after.stopped.at(-1))
  } finally { await s.restore() }
})
