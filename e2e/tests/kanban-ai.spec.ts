import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type CreatedTask = { id: string; code: string; threadId: string }
const password = 'e2e-password-1234'
async function signUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-kanban-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}
async function createTask(page: Page): Promise<CreatedTask> {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const created = await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })
  expect(created.ok()).toBe(true)
  return await created.json() as CreatedTask
}
/** 칸반 카드(stretched link의 부모) — 코드로 찾는다 */
function card(kanban: Page, task: CreatedTask) {
  return kanban.locator('.group', { has: kanban.getByRole('link', { name: new RegExp(task.code) }) })
}
async function openKanban(context: BrowserContext) {
  const kanban = await context.newPage()
  await kanban.goto('/?view=kanban&mine=1')
  return kanban
}

test('칸반 카드의 AI 응답 중 칩은 응답하는 동안 보이고 성공하면 사라진다', async ({ page, context }) => {
  await signUp(page)
  const task = await createTask(page)
  const kanban = await openKanban(context)
  await expect(card(kanban, task)).toBeVisible()
  await expect(card(kanban, task).locator('[data-ai-status]')).toHaveCount(0)
  await page.goto(`/c/${task.id}`)
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill('칸반 칩 확인')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  // Mock 응답은 수 초 안에 끝난다 — SSE(request.updated → ['tasks'] 무효화)로 다른 탭의 칸반이 갱신된다
  await expect(card(kanban, task).getByText('AI 응답 중')).toBeVisible()
  await expect(page.getByRole('button', { name: '중지' })).toBeHidden({ timeout: 30_000 })
  await expect(card(kanban, task).getByText('AI 응답 중')).toBeHidden()
  await expect(card(kanban, task).locator('[data-ai-status]')).toHaveCount(0)
})

test('AI 실패 필터 칩은 URL과 함께 실패한 대화만 남기고 초기화로 풀린다', async ({ page, context }) => {
  await signUp(page)
  const failed = await createTask(page)
  const clean = await createTask(page)
  // 요청 크기 한도(E2E 64 KiB) 초과 → 기록형 실패. 마지막 요청이 실패면 카드에 'AI 실패' 칩이 남는다
  const response = await page.request.post(`/api/threads/${failed.threadId}/requests`, { headers: { 'Idempotency-Key': `kanban-ai-${Date.now()}` }, data: { content: 'x'.repeat(70_000) } })
  expect(response.status()).toBe(201)
  const kanban = await openKanban(context)
  await expect(card(kanban, failed).getByText('AI 실패')).toBeVisible({ timeout: 30_000 })
  await expect(card(kanban, clean)).toBeVisible()
  await kanban.getByRole('button', { name: 'AI 실패' }).click()
  await expect(kanban).toHaveURL(/ai=failed/)
  await expect(kanban.getByRole('button', { name: 'AI 실패' })).toHaveAttribute('aria-pressed', 'true')
  await expect(card(kanban, failed)).toBeVisible()
  await expect(card(kanban, clean)).toHaveCount(0)
  await kanban.reload() // URL 공유 — 새로 열어도 같은 필터
  await expect(kanban.getByRole('button', { name: 'AI 실패' })).toHaveAttribute('aria-pressed', 'true')
  await expect(card(kanban, clean)).toHaveCount(0)
  await kanban.getByRole('button', { name: '초기화', exact: true }).click()
  await expect(kanban).not.toHaveURL(/ai=/)
  await expect(card(kanban, clean)).toBeVisible()
})

test.describe('빠른 전환 (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('내 진행 중 대화로 전환하고 돌아오면 입력창 초안·첨부가 남아 있고, 새로고침하면 사라진다', async ({ page }) => {
    await signUp(page)
    const first = await createTask(page)
    const second = await createTask(page)
    await page.goto(`/c/${first.id}`)
    const input = page.getByRole('textbox', { name: 'AI 요청 입력' })
    await input.fill('첫 대화 초안')
    await page.locator('input[type="file"]').setInputFiles({ name: 'draft-keep.txt', mimeType: 'text/plain', buffer: Buffer.from('초안 첨부') })
    await expect(page.getByText('draft-keep.txt')).toBeVisible()
    // 키보드로 열고 고른다
    await page.getByRole('button', { name: /빠른 전환/ }).focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveCount(2)
    await expect(menu.getByRole('menuitem').filter({ hasText: first.code })).toHaveAttribute('aria-current', 'page')
    await menu.getByRole('menuitem').filter({ hasText: second.code }).click()
    await expect(page).toHaveURL(new RegExp(`/c/${second.id}$`))
    await expect(page.getByText(second.code, { exact: true })).toBeVisible() // 헤더의 코드 span (TopBar 제목 '코드 · 제목'과 구분)
    await expect(input).toHaveValue('')
    await expect(page.getByText('draft-keep.txt')).toHaveCount(0)
    await input.fill('둘째 대화 초안')
    await page.getByRole('button', { name: /빠른 전환/ }).click()
    await page.getByRole('menu').getByRole('menuitem').filter({ hasText: first.code }).click()
    await expect(page).toHaveURL(new RegExp(`/c/${first.id}$`))
    await expect(input).toHaveValue('첫 대화 초안') // 메모리 Map에서 복원
    await expect(page.getByText('draft-keep.txt')).toBeVisible()
    await page.getByRole('button', { name: /빠른 전환/ }).click()
    await page.getByRole('menu').getByRole('menuitem').filter({ hasText: second.code }).click()
    await expect(input).toHaveValue('둘째 대화 초안')
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('') // 새로고침하면 유지하지 않는다
  })
})
