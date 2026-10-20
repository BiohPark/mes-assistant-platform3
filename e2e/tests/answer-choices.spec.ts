import { expect, test } from '@playwright/test'

test('mock 선택지 답변 → 칩 클릭 → 입력 수정 → 명시적 전송', async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password: 'e2e-password-1234' } })).ok()).toBe(true)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const response = await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: '선택 칩 mock' } })
  expect(response.ok()).toBe(true)
  const task = await response.json() as { id: string; threadId: string }
  const messages: Array<Record<string, unknown>> = []
  const sent: string[] = []
  await page.route(`**/api/threads/${task.threadId}/messages`, route => route.fulfill({ json: messages }))
  await page.route(`**/api/threads/${task.threadId}/requests`, async route => {
    const { content } = route.request().postDataJSON() as { content: string }
    sent.push(content)
    const suffix = sent.length
    const createdAt = '2026-10-20T00:00:00Z'
    const userId = `choice-user-${suffix}`, replyId = `choice-reply-${suffix}`
    const text = suffix === 1 ? '어떤 답변을 원하세요?\n1. 요약\n2. 자세한 설명' : '선택을 확인했습니다.'
    messages.push(
      { id: userId, threadId: task.threadId, seq: suffix * 2 - 1, role: 'user', content, status: 'done', attachmentIds: [], createdAt },
      { id: replyId, threadId: task.threadId, seq: suffix * 2, role: 'assistant', content: text, status: 'done', attachmentIds: [], createdAt },
    )
    await route.fulfill({ status: 201, contentType: 'text/event-stream', body: `event: started\ndata: ${JSON.stringify({ requestId: `choice-request-${suffix}`, replyMessageId: replyId, userMessageId: userId })}\n\nevent: completed\ndata: {}\n\n` })
  })
  await page.goto(`/c/${task.id}`)
  const composer = page.getByRole('textbox', { name: 'AI 요청 입력' })
  const send = page.getByRole('button', { name: '전송', exact: true })
  await composer.fill('답변 방식을 알려주세요')
  await send.click()
  const choices = page.getByRole('group', { name: '선택지', exact: true })
  await choices.getByRole('button', { name: '2. 자세한 설명' }).click()
  await expect(composer).toHaveValue('자세한 설명')
  await expect(composer).toBeFocused()
  expect(sent).toEqual(['답변 방식을 알려주세요'])
  await composer.press('End')
  await composer.pressSequentially(' 부탁해요')
  await send.click()
  await expect.poll(() => sent).toEqual(['답변 방식을 알려주세요', '자세한 설명 부탁해요'])
  await expect(choices).toHaveCount(0)
})
