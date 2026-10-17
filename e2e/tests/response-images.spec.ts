import { expect, test } from '@playwright/test'

test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) !== 'live', '가짜 OpenWebUI live 환경에서 실행')
const fake = `http://127.0.0.1:${process.env.E2E_FAKE_OWUI_PORT ?? '3102'}`

for (const mode of ['session', 'direct'] as const) test(`AI 답변 이미지: ${mode} 저장·자료함·미리보기·새로고침`, async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password: 'e2e-password-1234' } })).ok()).toBe(true)
  const original = await (await page.request.get('/api/settings')).json()
  try {
    expect((await page.request.patch('/api/settings', { data: { owuiMode: mode, owuiCleanup: true } })).ok()).toBe(true)
    const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
    const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: `image-persist-${mode}` } })).json() as { id: string; threadId: string }
    expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { modelId: 'fake-general' } })).ok()).toBe(true)
    await page.goto(`/c/${task.id}`)
    await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(`[image] draw ${Date.now()}`)
    await page.getByRole('button', { name: '전송', exact: true }).click()
    type Reply = { role: string; status: string; content: string; requestId: string; attachmentIds: string[] }
    const messages = async () => await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Reply[]
    await expect.poll(async () => (await messages()).find(row => row.role === 'assistant')?.status).toBe('done')
    const reply = (await messages()).find(row => row.role === 'assistant')!
    const report = await (await page.request.get(`/api/requests/${reply.requestId}/snapshot`)).json()
    const files = await (await page.request.get(`/api/tasks/${task.id}/files`)).json() as Array<{ id: string; kind: string; mime: string }>
    expect(files).toHaveLength(mode === 'session' ? 3 : 2)
    expect(files.every(file => file.kind === 'ai_output' && file.mime === 'image/png')).toBe(true)
    expect(reply.attachmentIds.sort()).toEqual(files.map(file => file.id).sort())
    expect(report.responseImages.failures).toEqual([])
    expect(report.responseImages.saved).toHaveLength(files.length)
    expect(reply.content).not.toMatch(/data:image|\/cache\/|\/api\/v1\/files/)
    if (mode === 'session') {
      const sessions = await (await page.request.get(`${fake}/__e2e/sessions`)).json()
      expect(sessions.deleted).toContain(report.chat_id)
      expect((await page.request.get(`${fake}/api/v1/chats/${report.chat_id}`)).status()).toBe(404)
      const remote = `/api/v1/files/generated-${report.chat_id}/content`
      expect((await page.request.get(`${fake}${remote}`, { headers: { authorization: 'Bearer e2e-fake-key' } })).status()).toBe(404)
    }
    for (const file of files) expect((await page.request.get(`/api/files/${file.id}/content`)).status()).toBe(200)
    const image = page.getByRole('img', { name: 'generated', exact: true })
    await expect(image).toHaveAttribute('src', /^\/api\/files\//)
    await expect.poll(async () => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    await image.click()
    await expect(page.getByRole('dialog').getByRole('img')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.reload()
    await expect.poll(async () => page.getByRole('img', { name: 'generated', exact: true }).evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    await page.getByRole('tablist', { name: '보조 패널' }).getByRole('tab', { name: '자료' }).click()
    await expect(page.getByText('AI 생성', { exact: true }).first()).toBeVisible()
  } finally {
    expect((await page.request.patch('/api/settings', { data: { owuiMode: original.owuiMode ?? 'auto', owuiCleanup: original.owuiCleanup ?? true } })).ok()).toBe(true)
  }
})
