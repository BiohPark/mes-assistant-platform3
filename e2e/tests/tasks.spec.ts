import { expect, test } from '@playwright/test'

const password = 'e2e-password-1234'

async function signUp(page: import('@playwright/test').Page, id: string) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(id)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/) // 세션 쿠키가 잡힌 뒤(허브 도착) 다음 이동 — 곧바로 goto하면 로그인 전에 이동해 /login으로 튕긴다
}

test('대화 생성, 태그와 칸반, 완료와 재개, 다른 사용자 조회', async ({ page, browser }) => {
  await signUp(page, `e2e-task-${Date.now()}-a`)
  await page.getByRole('link', { name: /새 대화/ }).first().click()
  await expect(page).toHaveURL(/\/new\//)
  await page.getByRole('button', { name: '팀 의견 (AI 미전송)' }).click()
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('첫 팀 의견')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page).toHaveURL(/\/c\/[^/]+$/)
  await expect(page.getByText(/WK-\d{4}-\d{4}/).first()).toBeVisible()
  const taskUrl = page.url()
  const tag = `공유태그-${Date.now()}` // 실행마다 고유 — 개발 DB에 남은 이전 실행 대화와 칸반에서 섞이지 않게
  await page.getByRole('combobox', { name: '태그 입력' }).fill(tag)
  await page.getByRole('combobox', { name: '태그 입력' }).press('Enter')
  await expect(page.getByText(tag).first()).toBeVisible()
  await page.goto(`/?view=kanban&tag=${encodeURIComponent(tag)}`)
  await expect(page.getByRole('link', { name: /WK-\d{4}-\d{4}.*열기/ })).toBeVisible()
  await page.goto(taskUrl)
  await page.getByRole('button', { name: '업무 완료' }).click()
  // U9: 필수 체크 항목이 미완료면 완료 사유가 필수다(시드 템플릿에 필수 항목이 있을 수 있음).
  const completeReason = page.getByRole('dialog').getByRole('textbox', { name: '완료 사유' })
  if (await completeReason.count()) await completeReason.fill('E2E 완료')
  await page.getByRole('dialog').getByRole('button', { name: '완료 처리' }).click()
  await expect(page.getByRole('button', { name: '다시 열기' })).toBeVisible()
  await page.getByRole('button', { name: '다시 열기' }).click()
  await page.getByPlaceholder('사유를 입력하세요').fill('추가 확인')
  await page.getByRole('button', { name: '재개 확인' }).click()
  await expect(page.getByRole('button', { name: '업무 완료' })).toBeVisible()

  const other = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    const second = await other.newPage()
    await signUp(second, `e2e-task-${Date.now()}-b`)
    await second.goto(taskUrl)
    await expect(second.getByText('첫 팀 의견')).toBeVisible()
  } finally { await other.close() }
})

test('새 대화의 첫 입력을 AI에 한 번 보내고 답변을 표시한다', async ({ page }) => {
  await signUp(page, `e2e-first-${Date.now()}`)
  await page.getByRole('link', { name: /새 대화/ }).first().click()
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill('첫 AI 질문 E2E')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page).toHaveURL(/\/c\/[^/]+$/)
  await expect(page.getByRole('paragraph').filter({ hasText: /^첫 AI 질문 E2E$/ })).toHaveCount(1) // 사용자 말풍선 1개 — 제목·답변 인용은 제외
  await expect(page.getByRole('button', { name: '사용한 자료' })).toHaveCount(1) // AI 답변 1개
})

test('대화 헤더의 사내 어시스턴트 바로가기는 링크가 설정된 에이전트에서만 새 탭으로 열린다', async ({ page, playwright, baseURL }) => {
  // 시드 에이전트에는 link1·modelId가 없다 — dev-owner로 잠시 link1을 넣고 끝나면 되돌린다
  const api = await playwright.request.newContext({ baseURL, timeout: 5_000 })
  expect((await api.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
  const assistants = await (await api.get('/api/assistants')).json() as Array<{ id: string; status: string; link1?: string }>
  const target = assistants.find((item) => item.status !== 'retired' && !item.link1)!
  const link1 = `https://openwebui.example/?model=e2e-shortcut-${Date.now()}`
  expect((await api.patch(`/api/assistants/${target.id}`, { data: { link1 } })).ok()).toBe(true)
  try {
    await signUp(page, `e2e-shortcut-${Date.now()}`)
    const created = await page.request.post('/api/tasks', { data: { assistantId: target.id, tags: [], title: '바로가기 대화' } })
    expect(created.ok()).toBe(true)
    const task = await created.json() as { id: string }
    await page.goto(`/c/${task.id}`)
    const shortcut = page.getByRole('link', { name: 'OpenWebUI에서 열기' })
    await expect(shortcut).toHaveAttribute('href', link1)
    await expect(shortcut).toHaveAttribute('target', '_blank')
    await expect(shortcut).toHaveAttribute('rel', 'noreferrer')
    const other = assistants.find((item) => item.status !== 'retired' && item.id !== target.id && !item.link1)!
    const plain = await page.request.post('/api/tasks', { data: { assistantId: other.id, tags: [], title: '바로가기 없음' } })
    expect(plain.ok()).toBe(true)
    await page.goto(`/c/${((await plain.json()) as { id: string }).id}`)
    await expect(page.getByRole('button', { name: '업무 완료' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'OpenWebUI에서 열기' })).toHaveCount(0)
  } finally {
    expect((await api.patch(`/api/assistants/${target.id}`, { data: { link1: null } })).ok()).toBe(true)
    await api.dispose()
  }
})
