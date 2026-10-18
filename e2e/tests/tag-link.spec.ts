import { expect, test, type Page } from '@playwright/test'

// S9-4 태그 연결 정확도 — 시드에 기대지 않고 테스트마다 사용자·대화·태그를 직접 만든다
const password = 'e2e-password-1234'
async function signup(page: Page, suffix: string) {
  const id = `tag-${suffix}-${Date.now()}`.slice(0, 32)
  await page.goto('/signup')
  await page.getByLabel('ID').fill(id)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill(id)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  return id
}
/** 목록 순서·첫 항목에 기대지 않고 활성(폐기 아님) 에이전트를 고른다. 없으면 이 spec은 검증 대상이 없으므로 건너뛴다 */
async function activeAssistantId(page: Page) {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
  const active = assistants.find((item) => item.status === 'open')
  test.skip(!active, '활성 에이전트가 없어 대화를 만들 수 없습니다')
  return active!.id
}
async function createTask(page: Page, tags: string[] = []) {
  const response = await page.request.post('/api/tasks', { data: { assistantId: await activeAssistantId(page), tags } })
  expect(response.ok()).toBe(true)
  return (await response.json()) as { id: string; code: string; threadId: string }
}
const tagInput = (page: Page) => page.getByRole('combobox', { name: '태그 입력' })
/** 대화 헤더(/c/)의 태그 입력은 [+]를 눌러 팝오버로 연다 — 초안(/new/)은 인라인 입력 그대로 */
const openTagInput = (page: Page) => page.getByRole('button', { name: '태그 추가' }).click()
const removeButton = (page: Page, tag: string) => page.getByRole('button', { name: `${tag} 태그 제거` })

test('Enter는 후보를 고르지 않으면 입력값 그대로 붙이고, ↑↓로 고른 후보만 붙인다', async ({ page }) => {
  await signup(page, 'enter')
  const stamp = Date.now().toString(36).toUpperCase()
  const popular = `CC-${stamp}-0010` // 사용 수 1위 후보
  const other = await createTask(page, [popular])
  const task = await createTask(page)
  await page.goto(`/c/${task.id}`)
  await openTagInput(page)
  await tagInput(page).fill(`CC-${stamp}-001`)
  await expect(page.getByRole('option', { name: new RegExp(popular) })).toBeVisible()
  await tagInput(page).press('Enter')
  await expect(removeButton(page, `CC-${stamp}-001`)).toBeVisible()
  await expect(removeButton(page, popular)).toHaveCount(0)
  await expect(tagInput(page)).toHaveAttribute('aria-busy', 'false') // 저장 중 Enter는 무시된다(중복 제출 방지) — 부하에서 저장이 늦다

  await tagInput(page).fill(`CC-${stamp}-00`)
  await expect(page.getByRole('option', { name: new RegExp(popular) })).toBeVisible() // 후보가 온 뒤에 고른다(부하에서 추천 조회가 늦다)
  await tagInput(page).press('ArrowDown')
  await tagInput(page).press('Enter')
  await expect(removeButton(page, popular)).toBeVisible()
  await page.keyboard.press('Escape') // 태그 입력 팝오버 닫기

  const related = page.getByTestId(`conversation-${other.id}`)
  await expect(related).toContainText(other.code)
  await expect(related).toContainText(popular)

})

test('접수되지 않은 SR 번호 태그는 SR 미접수로 구분되고 입력창 첨부 칩에 없다', async ({ page }) => {
  await signup(page, 'sr')
  const task = await createTask(page)
  // 실행마다 다른 번호 — 지속 DB에 남은 이전 실행의 태그와 겹치지 않게
  const now = Date.now()
  const srTag = `SR-${3000 + now % 7000}-${String(now % 10_000).padStart(4, '0')}`
  await page.goto(`/c/${task.id}`)
  await openTagInput(page)
  await tagInput(page).fill(srTag)
  await tagInput(page).press('Enter')
  const chip = page.locator('[data-slot="chip"]', { hasText: srTag })
  await expect(chip).toContainText('SR 미접수')
  await expect(page.getByRole('textbox', { name: 'AI 요청 입력' })).toBeVisible()
  await expect(page.getByRole('list', { name: '첨부', exact: true })).toHaveCount(0)
  // 이 번호를 쓰는 다른 대화가 없으니 0건 표시
  await expect(page.getByTestId('conversation-candidates').getByText(/^같은 태그 대화가 없습니다\./)).toBeVisible()
})

test('초안에서 입력한 태그를 쓰는 대화 수를 미리 보여 주되 아무것도 저장하지 않는다', async ({ page }) => {
  await signup(page, 'draft')
  const stamp = Date.now().toString(36)
  const tag = `draft-${stamp}`
  const existing = await createTask(page, [tag])
  // 공유 DB의 다른 worker가 만든 대화는 제외하고 이 사용자·태그 범위만 비교한다.
  const countTasks = async () => {
    const response = await page.request.get('/api/tasks', { params: { mine: 'true', tag } })
    expect(response.ok()).toBe(true)
    return (await response.json() as unknown[]).length
  }
  const before = await countTasks()
  await page.goto(`/new/${await activeAssistantId(page)}`)
  await tagInput(page).fill(tag)
  await tagInput(page).press('Enter')
  await page.locator('[data-tour="related"] > summary').click() // 자료함의 '같은 태그 대화 1개' 제목과 구분
  await expect(page.getByRole('link', { name: new RegExp(existing.code) })).toBeVisible()
  expect(await countTasks()).toBe(before)
})
