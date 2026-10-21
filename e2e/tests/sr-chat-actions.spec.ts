import { expect, test } from '@playwright/test'

test('BO SR 접수: 선택지는 초안만 채우고 표시 모드·검색·다시 묻기를 제공한다', async ({ page, browser }) => {
  const password = 'e2e-password-1234'
  const loginId = `sr-tools-${Date.now().toString(36)}`
  const signup = await page.request.post('/api/auth/signup', { data: { loginId, password } })
  expect(signup.ok()).toBe(true)
  const { id } = await signup.json() as { id: string }
  const owner = await browser.newContext({ baseURL: process.env.APP_ORIGIN ?? 'http://localhost:5173' })
  let originalIntake: string | null = null
  try {
    expect((await owner.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
    originalIntake = (await (await owner.request.get('/api/settings')).json() as { srIntakeAssistantId: string | null }).srIntakeAssistantId
    const assistants = await (await owner.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
    expect((await owner.request.patch('/api/settings', { data: { srIntakeAssistantId: assistants.find(item => item.status === 'open')!.id } })).ok()).toBe(true)
    expect((await owner.request.put(`/api/users/${id}/business-owner`, { data: { enabled: true } })).status()).toBe(204)
    await page.goto('/login')
    await page.getByLabel('ID', { exact: true }).fill(loginId)
    await page.getByLabel('비밀번호', { exact: true }).fill(password)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL(/\/sr$/)
    const messages: Array<Record<string, unknown>> = []
    const sent: Array<{ content: string; detail: string }> = []
    await page.route('**/api/threads/*/messages', route => route.fulfill({ json: messages }))
    await page.route('**/api/threads/*/requests', async route => {
      sent.push(route.request().postDataJSON() as { content: string; detail: string })
      const threadId = new URL(route.request().url()).pathname.split('/')[3]!
      const createdAt = '2026-10-20T00:00:00Z'
      messages.push(
        { id: 'sr-question', threadId, role: 'user', kind: 'chat', content: sent[0]!.content, status: 'done', attachmentIds: [], createdAt },
        { id: 'sr-answer', threadId, role: 'assistant', requestId: 'sr-choice-request', content: '어떤 답변을 원하세요?\n1. 요약\n2. 자세한 설명', reasoning: '선택 전 생각', status: 'done', attachmentIds: [], createdAt },
      )
      await route.fulfill({ contentType: 'text/event-stream', body: 'event: started\ndata: {"requestId":"sr-choice-request","replyMessageId":"sr-answer","userMessageId":"sr-question"}\n\nevent: completed\ndata: {}\n\n' })
    })
    await page.getByRole('button', { name: '새 요청', exact: true }).click()
    const toggle = page.getByTestId('answer-detail-toggle')
    await expect(toggle).toHaveAttribute('data-answer-detail', 'answer')
    const composer = page.getByRole('textbox', { name: '접수 메시지', exact: true })
    await composer.fill('답변 방식을 알려주세요')
    await composer.press('Enter')
    await page.getByRole('group', { name: '선택지', exact: true }).getByRole('button', { name: '2. 자세한 설명' }).click()
    await expect(composer).toHaveValue('자세한 설명')
    await expect(composer).toBeFocused()
    expect(sent).toEqual([{ content: '답변 방식을 알려주세요', attachmentIds: [], oneShotFileIds: [], detail: 'answer' }])
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-answer-detail', 'full')
    await expect(page.getByText('생각 과정', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '사용한 자료', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '응답 원문 보기', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '대화 내 검색', exact: true }).click()
    const search = page.getByRole('searchbox', { name: '대화 내 검색' })
    await search.fill('답변')
    await expect(page.locator('[data-search-match="true"]')).toHaveAttribute('data-message-id', 'sr-question')
    await search.press('Enter')
    await expect(page.locator('[data-search-match="true"]')).toHaveAttribute('data-message-id', 'sr-answer')
    await search.press('Escape')
    await page.getByRole('button', { name: '다시 묻기', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '텍스트 바꾸기', exact: true }).click()
    await expect(composer).toHaveValue('답변 방식을 알려주세요')
    await expect(composer).toBeFocused()
    expect(sent).toHaveLength(1)
    await page.reload()
    await expect(toggle).toHaveAttribute('data-answer-detail', 'full')
  } finally {
    expect((await owner.request.patch('/api/settings', { data: { srIntakeAssistantId: originalIntake } })).ok()).toBe(true)
    await owner.close()
  }
})
