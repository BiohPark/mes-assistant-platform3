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
const removeButton = (page: Page, tag: string) => page.getByRole('button', { name: `${tag} 태그 제거` })

test('Enter는 후보를 고르지 않으면 입력값 그대로 붙이고, ↑↓로 고른 후보만 붙인다', async ({ page }) => {
  await signup(page, 'enter')
  const stamp = Date.now().toString(36).toUpperCase()
  const popular = `CC-${stamp}-0010` // 사용 수 1위 후보
  const other = await createTask(page, [popular])
  const task = await createTask(page)
  await page.goto(`/c/${task.id}`)
  await tagInput(page).fill(`CC-${stamp}-001`)
  await expect(page.getByRole('option', { name: new RegExp(popular) })).toBeVisible()
  await tagInput(page).press('Enter')
  await expect(removeButton(page, `CC-${stamp}-001`)).toBeVisible()
  await expect(removeButton(page, popular)).toHaveCount(0)

  await tagInput(page).fill(`CC-${stamp}-00`)
  await tagInput(page).press('ArrowDown')
  await tagInput(page).press('Enter')
  await expect(removeButton(page, popular)).toBeVisible()

  // 같은 태그 대화 — 태그별 묶음 안에 상대 대화 링크
  await page.getByText('같은 태그 대화 1').click()
  const popup = page.getByText('같은 태그를 가진 대화').locator('..')
  await expect(popup.getByRole('link', { name: new RegExp(other.code) })).toHaveAttribute('href', `/c/${other.id}`)
  await expect(popup.getByText(popular, { exact: true })).toBeVisible()
})

test('접수되지 않은 SR 번호 태그는 SR 미접수로 구분되고 트레이의 SR 본문 목록에 없다', async ({ page }) => {
  await signup(page, 'sr')
  const task = await createTask(page)
  // 실행마다 다른 번호 — 지속 DB에 남은 이전 실행의 태그와 겹치지 않게
  const now = Date.now()
  const srTag = `SR-${3000 + now % 7000}-${String(now % 10_000).padStart(4, '0')}`
  await page.goto(`/c/${task.id}`)
  await tagInput(page).fill(srTag)
  await tagInput(page).press('Enter')
  const chip = page.locator('[data-slot="chip"]', { hasText: srTag })
  await expect(chip).toContainText('SR 미접수')
  await expect(page.getByLabel('이번 요청에 사용할 자료')).toBeVisible()
  await expect(page.getByText(/^SR 본문 포함/)).toHaveCount(0)
  // 이 번호를 쓰는 다른 대화가 없으니 0건 표시
  await expect(page.getByText('같은 태그 대화 없음')).toBeVisible()
})

test('초안에서 입력한 태그를 쓰는 대화 수를 미리 보여 주되 아무것도 저장하지 않는다', async ({ page }) => {
  await signup(page, 'draft')
  const stamp = Date.now().toString(36)
  const existing = await createTask(page, [`draft-${stamp}`])
  const before = (await (await page.request.get('/api/tasks')).json() as unknown[]).length
  await page.goto(`/new/${await activeAssistantId(page)}`)
  await tagInput(page).fill(`draft-${stamp}`)
  await tagInput(page).press('Enter')
  await page.getByText('같은 태그 대화 1').click()
  await expect(page.getByRole('link', { name: new RegExp(existing.code) })).toBeVisible()
  expect((await (await page.request.get('/api/tasks')).json() as unknown[]).length).toBe(before)
})
