import { expect, test } from '@playwright/test'

const mode = process.env.E2E_LLM_MODE ?? process.env.LLM_MODE ?? 'mock'

test(`S10 ${mode}: keeps thinking collapsed with a last-lines preview, drops it on answer, preserves reasoning and excludes it from follow-up context`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-reasoning-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('이름').fill('생각 사용자')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; name: string }>
  // 제목을 정해 둔다 — 기본 제목이면 첫 답 뒤 배경 AI 제목(maybeTitle)이 시스템 프롬프트의 대화 제목을 바꾸는데, 보조 요청 슬롯이 겹치면 다음 성공 뒤로
  // 미뤄져 후속 질문의 추정과 전송 사이에 끼어들 수 있다(live 4바이트 차). 이 테스트가 보는 것은 생각 과정과 '보낸 것=본 것'이다
  const created = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: '생각 과정 확인' } })).json() as { id: string; threadId: string }
  await page.goto(`/c/${created.id}`)
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill('[reasoning] 응답 대기 확인')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '생각 중' })).toBeVisible()
  await expect(page.getByRole('timer')).toHaveText(/\d+초 경과/)
  const replyBubble = page.locator('[data-message-id]').filter({ has: page.locator('details').filter({ hasText: '생각 과정' }) }).last()
  const disclosure = replyBubble.locator('details')
  // S14: 생각 과정은 기본 접힘 — 생각하는 동안 마지막 줄 미리보기만 보인다
  const preview = disclosure.locator('[data-reasoning-preview]')
  await expect(disclosure).not.toHaveAttribute('open', '')
  await expect(preview).toContainText('PRIVATE_REASONING')
  await expect(replyBubble.locator('.md-body')).toHaveCount(0)
  const header = replyBubble.getByRole('status').locator('..')
  await expect(header).toContainText(assistants[0]!.name) // S11 U1: 'assistant' 대신 에이전트 이름
  await expect(header.getByRole('timer')).toHaveText(/[1-9]\d*초 경과/)
  await expect(preview).toContainText('답변을 준비합니다.')
  await expect(replyBubble.locator('.md-body')).toBeVisible()
  await expect(disclosure).not.toHaveAttribute('open', '')
  await expect(preview).toHaveCount(0)
  await expect(disclosure.getByText(/PRIVATE_REASONING/)).toBeHidden()
  await expect(page.getByRole('timer')).toHaveCount(0)
  const messages = await (await page.request.get(`/api/threads/${created.threadId}/messages`)).json() as Array<{ id: string; role: string; content: string; reasoning?: string; requestId?: string }>
  const reply = messages.findLast(item => item.role === 'assistant')!
  expect(reply.reasoning).toContain('PRIVATE_REASONING')
  expect(reply.content).not.toContain('PRIVATE_REASONING')
  await page.reload()
  const savedDisclosure = page.locator('details').filter({ hasText: '생각 과정' }).last()
  await expect(savedDisclosure).not.toHaveAttribute('open', '')
  await expect(page.getByRole('timer')).toHaveCount(0)
  await savedDisclosure.locator('summary').click()
  await expect(savedDisclosure).toHaveAttribute('open', '')
  await expect(savedDisclosure.getByText(/PRIVATE_REASONING/)).toBeVisible()
  const followUp = `후속 질문 ${created.id}` // 공유 가짜 서버에서도 이 대화의 요청만 찾는다.
  const estimate = await (await page.request.post(`/api/threads/${created.threadId}/requests/estimate`, { data: { draft: followUp } })).json() as { bytes: number }
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(followUp)
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect.poll(async () => {
    const rows = await (await page.request.get(`/api/threads/${created.threadId}/messages`)).json() as typeof messages
    const next = rows.findLast(item => item.role === 'assistant')
    if (!next?.requestId || next.id === reply.id) return undefined
    const record = await (await page.request.get(`/api/requests/${next.requestId}`)).json() as { bytes: number; status: string }
    return record.status
  }).toBe('succeeded')
  const rows = await (await page.request.get(`/api/threads/${created.threadId}/messages`)).json() as typeof messages
  const next = rows.findLast(item => item.role === 'assistant')!
  expect(next.id).not.toBe(reply.id)
  const record = await (await page.request.get(`/api/requests/${next.requestId}`)).json() as { bytes: number; status: string }
  expect(record.status).toBe('succeeded')
  expect(record.bytes).toBe(estimate.bytes)
  const snapshotResponse = await page.request.get(`/api/requests/${next.requestId}/snapshot`)
  expect(snapshotResponse.ok()).toBe(true)
  const snapshot = await snapshotResponse.json()
  expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_REASONING')
  await expect(page.getByRole('timer')).toHaveCount(0)
  if (mode === 'live') {
    const captured = await (await page.request.get(`http://127.0.0.1:${process.env.E2E_FAKE_OWUI_PORT ?? '3102'}/__e2e/requests`)).json() as Array<{ messages: Array<{ content: string }> }>
    const next = captured.findLast(entry => entry.messages.at(-1)?.content === followUp)!
    expect(next).toBeTruthy()
    expect(JSON.stringify(next)).not.toContain('PRIVATE_REASONING')
  }
})
