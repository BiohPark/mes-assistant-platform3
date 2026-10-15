import { expect, test, type Page } from '@playwright/test'

// S11 U2 같은 태그 펼침 패널·담기 — 시드에 기대지 않고 테스트마다 사용자·대화·태그를 직접 만든다
const password = 'e2e-password-1234'
async function signup(page: Page, suffix: string) {
  const id = `cmp-${suffix}-${Date.now()}`.slice(0, 32)
  await page.goto('/signup')
  await page.getByLabel('ID').fill(id)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill(id)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}
async function createTask(page: Page, tags: string[]) {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
  const active = assistants.find((item) => item.status === 'open')
  test.skip(!active, '활성 에이전트가 없어 대화를 만들 수 없습니다')
  const response = await page.request.post('/api/tasks', { data: { assistantId: active!.id, tags } })
  expect(response.ok()).toBe(true)
  return (await response.json()) as { id: string; code: string; threadId: string }
}
async function answered(page: Page, threadId: string, content: string) {
  const result = await page.request.post(`/api/threads/${threadId}/requests`, { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { content } })
  expect(result.status()).toBe(201)
  await expect.poll(async () => (await (await page.request.get(`/api/threads/${threadId}/messages`)).json() as Array<{ status: string }>).at(-1)?.status).toBe('done')
}
const panel = (page: Page) => page.getByText('같은 태그를 가진 대화').locator('..')

test('indirect tag not listed — 다른 태그로만 이어진 대화는 패널에 없고, 직접 공유 대화도 기본 무체크다', async ({ page }) => {
  await signup(page, 'ind')
  const stamp = Date.now().toString(36)
  const me = await createTask(page, [`cmp-x-${stamp}`])
  const bridge = await createTask(page, [`cmp-x-${stamp}`, `cmp-y-${stamp}`])
  const indirect = await createTask(page, [`cmp-y-${stamp}`])
  await page.goto(`/c/${me.id}`)
  await page.getByText('같은 태그 대화 1').click()
  await expect(panel(page).getByRole('link', { name: new RegExp(bridge.code) })).toBeVisible()
  await expect(panel(page).getByRole('link', { name: new RegExp(indirect.code) })).toHaveCount(0)
  const box = panel(page).getByRole('checkbox', { name: `${bridge.code} 대화 본문(전체 스냅샷) 담기` })
  await expect(box).toBeEnabled()
  await expect(box).not.toBeChecked()
  await expect(panel(page).getByRole('checkbox')).toHaveCount(1)
})

test('estimate equals send after add — 패널에서 대화 본문·파일을 담은 뒤 트레이 추정과 실제 전송 크기가 같다', async ({ page }) => {
  test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) === 'live', 'Mock 전용 기록 검사')
  await signup(page, 'est')
  const tag = `cmp-est-${Date.now().toString(36)}`
  const source = await createTask(page, [tag])
  const consumer = await createTask(page, [tag])
  await answered(page, source.threadId, '담기 원본 질문 U2')
  const fileName = `compose-${Date.now()}.txt`
  const upload = await page.request.post('/api/files', { multipart: { originTaskId: source.id, file: { name: fileName, mimeType: 'text/plain', buffer: Buffer.from('담기 자료 본문 U2') } } })
  expect(upload.ok()).toBe(true)

  await page.goto(`/c/${consumer.id}`)
  await page.getByText('같은 태그 대화 1').click()
  await panel(page).getByRole('checkbox', { name: `${source.code} 대화 본문(전체 스냅샷) 담기` }).check()
  await panel(page).getByRole('button', { name: `${source.code} 파일 펼치기` }).click()
  await panel(page).getByRole('radiogroup', { name: `${fileName} 버전` }).getByRole('radio', { name: 'v1' }).check()
  await panel(page).getByRole('button', { name: '담기 · 2' }).click()
  await expect(panel(page).getByText('담음 2 · 실패 0 · 미처리 0')).toBeVisible()
  // 담긴 항목은 체크·비활성 — 덮어쓰기 없음
  await expect(panel(page).getByRole('checkbox', { name: `${source.code} 대화 본문(전체 스냅샷) 담기` })).toBeDisabled()
  await expect(panel(page).getByRole('checkbox', { name: `${source.code} 대화 본문(전체 스냅샷) 담기` })).toBeChecked()

  const draft = '담은 자료로 답해 줘 U2'
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(draft)
  const tray = page.getByLabel('다음 질문에 보낼 자료')
  await expect(tray.getByText('다음 질문에 보낼 자료 · 2')).toBeVisible()
  const estimate = await (await page.request.post(`/api/threads/${consumer.threadId}/requests/estimate`, { data: { draft } })).json() as { bytes: number }
  // 화면 추정(트레이 미터)이 같은 조립 함수의 추정과 같다
  await expect(tray.getByRole('meter')).toHaveAttribute('aria-valuenow', String(estimate.bytes))
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(async () => {
    const messages = await (await page.request.get(`/api/threads/${consumer.threadId}/messages`)).json() as Array<{ role: string; requestId?: string }>
    const reply = messages.findLast((item) => item.role === 'assistant' && !!item.requestId)
    expect(reply).toBeDefined()
    const record = await (await page.request.get(`/api/requests/${reply!.requestId}`)).json() as { bytes: number; status: string }
    expect(record.status).toBe('succeeded')
    expect(record.bytes).toBe(estimate.bytes)
  }).toPass()
})
