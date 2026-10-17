import { expect, test } from './owui-settings-fixture.js'

test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) !== 'live', '가짜 OpenWebUI live 환경에서 실행')
const fake = `http://127.0.0.1:${process.env.E2E_FAKE_OWUI_PORT ?? '3102'}`

test('기본 터미널 설정 → 모델 기본값이 없는 요청의 terminal_id·전송 기록 출처', async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password: 'e2e-password-1234' } })).ok()).toBe(true)
  const original = await (await page.request.get('/api/settings')).json()
  try {
    expect((await page.request.patch('/api/settings', { data: { owuiDefaultTerminalId: null, owuiTools: 'auto', owuiMode: 'direct' } })).ok()).toBe(true)
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings$/)
    const select = page.getByRole('combobox', { name: '기본 터미널' })
    await expect(select).toBeEnabled()
    await select.click()
    await expect(page.getByRole('option', { name: '가짜 코드 실행 서버' })).toBeVisible()
    const saved = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH')
    await page.getByRole('option', { name: '가짜 코드 실행 서버' }).click()
    expect((await saved).ok()).toBe(true)
    expect((await (await page.request.get('/api/settings')).json()).owuiDefaultTerminalId).toBe('fake-terminal')
    const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
    const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: 'terminal default' } })).json() as { id: string; threadId: string }
    expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { modelId: 'fake-writer' } })).ok()).toBe(true)
    const prompt = `terminal-default-${Date.now()}`
    await page.goto(`/c/${task.id}`)
    await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(prompt)
    await page.getByRole('button', { name: '전송', exact: true }).click()
    await expect.poll(async () => {
      const rows = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Array<{ role: string; status: string }>
      return rows.find(row => row.role === 'assistant')?.status
    }).toBe('done')
    const rows = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Array<{ role: string; requestId?: string }>
    const id = rows.find(row => row.role === 'assistant')!.requestId!
    expect(await (await page.request.get(`/api/requests/${id}`)).json()).toMatchObject({ status: 'succeeded',
      owuiTools: { mode: 'tools', terminal_id: 'fake-terminal', terminalSource: 'global' } })
    const snapshot = await (await page.request.get(`/api/requests/${id}/snapshot`)).json()
    expect(snapshot).toMatchObject({ model: 'fake-writer', terminal_id: 'fake-terminal' })
    const captured = await (await page.request.get(`${fake}/__e2e/requests`)).json() as Array<Record<string, unknown>>
    const sent = captured.filter(row => JSON.stringify(row.messages).includes(prompt))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ terminal_id: snapshot.terminal_id, messages: snapshot.messages })
    expect(sent[0]).not.toHaveProperty('terminalSource')
  } finally {
    expect((await page.request.patch('/api/settings', { data: { owuiDefaultTerminalId: original.owuiDefaultTerminalId ?? null,
      owuiTools: original.owuiTools ?? 'auto', owuiMode: original.owuiMode ?? 'auto' } })).ok()).toBe(true)
  }
})
