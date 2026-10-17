import { networkInterfaces } from 'node:os'
import { expect, test } from '@playwright/test'

test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) !== 'live', '가짜 OpenWebUI 테스트 서버 사용')
// Loopback stays blocked in all environments. The local fixture server is reached over the LAN interface.
const address = Object.values(networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)?.address
const origin = process.env.E2E_URL_READER_ORIGIN ?? (address ? `http://${address}:${process.env.E2E_FAKE_OWUI_PORT ?? '3102'}` : undefined)

test('질문 URL을 추정 때 읽고 같은 내용을 전송하며 자료·실패를 기록한다', async ({ page }) => {
  test.skip(!origin, '테스트 서버의 사설 IP 또는 E2E_URL_READER_ORIGIN 필요')
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`url-reader-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('이름').fill('URL 사용자')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string; threadId: string }
  const content = `${origin}/__e2e/pages/redirect ${origin}/__e2e/pages/blocked 요약해 줘`
  const estimate = await (await page.request.post(`/api/threads/${task.threadId}/requests/estimate`, { data: { draft: content } })).json() as { bytes: number; webPages: Array<{ status: string; bytes: number }> }
  expect(estimate.webPages.map(page => page.status)).toEqual(['read', 'failed'])
  await page.goto(`/c/${task.id}`)
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(content)
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByText(/files: 0/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '중지' })).toBeHidden()
  await page.getByRole('button', { name: '사용한 자료' }).click()
  await expect(page.getByRole('dialog')).toContainText('읽지 못함(차단된 주소)')
  const messages = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Array<{ requestId?: string }>
  const requestId = messages.at(-1)!.requestId!
  const record = await (await page.request.get(`/api/requests/${requestId}`)).json() as { bytes: number }
  expect(record.bytes).toBe(estimate.bytes)
  const snapshot = await (await page.request.get(`/api/requests/${requestId}/snapshot`)).json() as { messages: Array<{ content: string }> }
  expect(snapshot.messages[0]!.content).toContain('URL-READER-ARTICLE')
  expect(snapshot.messages[0]!.content).not.toMatch(/IGNORE-NAV|IGNORE-SCRIPT/)
})
