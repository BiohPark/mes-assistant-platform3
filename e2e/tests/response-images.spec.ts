import { expect, test } from './owui-settings-fixture.js'
import { revealMaterials } from './materials.js'

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
    const prompt = `[image] draw ${mode} task=${task.id}`
    await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(prompt)
    await page.getByRole('button', { name: '전송', exact: true }).click()
    type Reply = { role: string; status: string; content: string; requestId: string; attachmentIds: string[] }
    const messages = async () => await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Reply[]
    await expect.poll(async () => (await messages()).find(row => row.role === 'assistant')?.status).toBe('done')
    const reply = (await messages()).find(row => row.role === 'assistant')!
    expect(reply.content).toContain(prompt)
    const report = await (await page.request.get(`/api/requests/${reply.requestId}/snapshot`)).json()
    expect(report.mode).toBe(mode)
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
    await revealMaterials(page)
    await expect(page.getByRole('complementary', { name: '#태그·SR 연결 자료' }).getByText('AI 생성', { exact: true }).first()).toBeVisible()
  } finally {
    expect((await page.request.patch('/api/settings', { data: { owuiMode: original.owuiMode ?? 'auto', owuiCleanup: original.owuiCleanup ?? true } })).ok()).toBe(true)
  }
})

test('SR requester BO sees system-owner generated images and library updates after OpenWebUI cleanup', async ({ page, browser }) => {
  const password = 'e2e-password-1234'
  const ownerContext = await browser.newContext({ baseURL: process.env.APP_ORIGIN ?? 'http://localhost:5173' })
  const owner = await ownerContext.newPage()
  expect((await owner.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
  const original = await (await owner.request.get('/api/settings')).json()
  try {
    const assistants = await (await owner.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
    const intake = assistants.find(item => item.status === 'open')!
    expect((await owner.request.patch('/api/settings', { data: { srIntakeAssistantId: intake.id, owuiMode: 'session', owuiCleanup: true } })).ok()).toBe(true)
    const loginId = `image-bo-${Date.now().toString(36)}`
    const signup = await page.request.post('/api/auth/signup', { data: { loginId, password } })
    expect(signup.ok()).toBe(true)
    const bo = await signup.json() as { id: string }
    expect((await owner.request.put(`/api/users/${bo.id}/business-owner`, { data: { enabled: true } })).status()).toBe(204)
    await page.request.post('/api/auth/logout')
    expect((await page.request.post('/api/auth/login', { data: { loginId, password } })).ok()).toBe(true)
    const create = await page.request.post('/api/service-requests')
    expect(create.ok()).toBe(true)
    const sr = await create.json() as { id: string; threadId: string }
    const eventsConnected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/events')
    await page.goto(`/sr?id=${sr.id}`)
    expect((await eventsConnected).status(), 'BO must receive SR updates through SSE').toBe(200)
    await expect(page.getByRole('textbox', { name: '접수 메시지' })).toBeVisible()
    const library = page.getByTestId('sr-materials-library')
    await expect(library).toHaveCount(0)
    // Keep the BO view open while another actor completes the response: the library needs sr.updated.
    const prompt = `[image] draw requester sr=${sr.id}`
    const result = await owner.request.post(`/api/threads/${sr.threadId}/requests`, {
      headers: { 'Idempotency-Key': `sr-image-${sr.id}` }, data: { content: prompt },
    })
    expect(result.ok()).toBe(true)
    const messages = await (await page.request.get(`/api/threads/${sr.threadId}/messages`)).json() as Array<{ role: string; status: string; content: string; requestId: string; attachmentIds: string[] }>
    const reply = messages.find(item => item.role === 'assistant')!
    expect(reply.status).toBe('done')
    expect(reply.content).toContain(prompt)
    expect(reply.attachmentIds).toHaveLength(3)
    for (const id of reply.attachmentIds) {
      const meta = await (await page.request.get(`/api/files/${id}`)).json()
      expect(meta).toMatchObject({ kind: 'ai_output', originSrId: sr.id })
      expect(meta.uploadedBy).not.toBe(bo.id)
      expect((await page.request.get(`/api/files/${id}/content`)).status()).toBe(200)
    }
    const report = await (await owner.request.get(`/api/requests/${reply.requestId}/snapshot`)).json()
    expect(report.mode).toBe('session')
    expect((await owner.request.get(`${fake}/api/v1/chats/${report.chat_id}`)).status()).toBe(404)
    expect((await owner.request.get(`${fake}/api/v1/files/generated-${report.chat_id}/content`, { headers: { authorization: 'Bearer e2e-fake-key' } })).status()).toBe(404)
    await expect(library).toBeVisible()
    for (const id of reply.attachmentIds) await expect(library.getByTestId(`file-${id}`)).toBeVisible()
    await expect(library.getByText('AI 생성', { exact: true })).toHaveCount(reply.attachmentIds.length)
    const image = page.getByRole('img', { name: 'generated', exact: true })
    await expect.poll(async () => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    await image.click()
    await expect(page.getByRole('dialog').getByRole('img')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.reload()
    await expect.poll(async () => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
  } finally {
    expect((await owner.request.patch('/api/settings', { data: { srIntakeAssistantId: original.srIntakeAssistantId ?? null,
      owuiMode: original.owuiMode ?? 'auto', owuiCleanup: original.owuiCleanup ?? true } })).ok()).toBe(true)
    await ownerContext.close()
  }
})
