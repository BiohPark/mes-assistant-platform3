import { expect, test } from '@playwright/test'

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
      expect((await page.request.patch('/api/settings', { data: { owuiTools: mode === 'basic' ? 'off' : 'auto' } })).ok()).toBe(true)
      const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: `owui-${mode}` } })).json() as { id: string; threadId: string }
      // 작업 모델을 지정해 에이전트 매핑·전역 모델에 영향받지 않는다.
      expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { modelId: 'fake-general' } })).ok()).toBe(true)
      const prompt = `owui-tools-${mode}-${Date.now()}`
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
    expect((await page.request.patch('/api/settings', { data: { owuiTools: original.owuiTools ?? 'auto' } })).ok()).toBe(true)
  }
})
