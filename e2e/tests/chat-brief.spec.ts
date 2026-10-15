import { expect, test } from '@playwright/test'

const live = (process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) === 'live'
// mock은 규칙 카드, live는 가짜 OpenWebUI의 고정 응답 — 둘 다 결정적이다
const expected = live
  ? { about: '가짜 OpenWebUI 대화 요약', next: '가짜 OpenWebUI가 제안하는 다음 할 일' }
  : { about: '(Mock 대역) 요약 카드 확인', next: '(Mock 대역) 마지막 답변을 확인하고 이어서 질문하세요' }

test('AI 답이 온 대화에 다시 들어오면 요약 카드를 백그라운드로 만들어 위에 보이고, 접힘을 기억한다', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-brief-${Date.now().toString(36)}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('이름').fill('요약 카드 사용자')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants.find((item) => item.status !== 'retired')!.id } })).json() as { id: string }
  await page.goto(`/c/${task.id}`)
  await expect(page.getByTestId('chat-brief')).toHaveCount(0) // 빈 대화에는 카드가 없다
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill('요약 카드 확인')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect.poll(async () => ((await (await page.request.get(`/api/threads/${(await (await page.request.get(`/api/tasks/${task.id}`)).json() as { threadId: string }).threadId}/messages`)).json()) as Array<{ role: string; status: string }>)
    .some((item) => item.role === 'assistant' && item.status === 'done'), { timeout: 30_000 }).toBe(true)
  // 진입(GET)이 생성을 건다 — 저장될 때까지 다시 들어온다
  await expect.poll(async () => ((await (await page.request.get(`/api/tasks/${task.id}/brief`)).json()) as { ai?: { about: string } }).ai?.about, { timeout: 30_000 }).toBe(expected.about)
  await page.reload()
  const card = page.getByTestId('chat-brief')
  await expect(card).toContainText('AI 요약·제안')
  await expect(card).toContainText(expected.about)
  await expect(card).toContainText('질문 1회')
  await expect(card).toContainText(expected.next)
  await card.getByRole('button', { name: /AI 요약·제안/ }).click()
  await expect(card).not.toContainText(expected.about)
  await page.reload()
  await expect(page.getByTestId('chat-brief')).not.toContainText(expected.about)
  await expect(page.getByTestId('chat-brief').getByRole('button', { name: /AI 요약·제안/ })).toHaveAttribute('aria-expanded', 'false')
})
