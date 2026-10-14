import { expect, test } from '@playwright/test'

test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) !== 'live', '가짜 OpenWebUI live 환경에서 실행')

test('에이전트 목록을 처음 읽으면 추천 첫 질문을 백그라운드로 만들어 저장하고 다음 조회부터 내려준다', async ({ page }) => {
  const signup = await page.request.post('/api/auth/signup', { data: { loginId: `e2e-first-q-${Date.now().toString(36)}`, password: 'e2e-password-1234', name: '추천 질문 사용자' } })
  expect(signup.ok()).toBe(true)
  const first = async () => ((await (await page.request.get('/api/assistants')).json()) as Array<{ status: string; suggestedQuestions?: string[] }>).find((item) => item.status !== 'retired')
  await expect.poll(async () => (await first())?.suggestedQuestions, { timeout: 30_000 })
    .toEqual(['이 에이전트는 무엇을 도와주나요?', '시작하려면 어떤 자료가 필요한가요?', '결과는 어떤 형태로 받나요?'])
})
