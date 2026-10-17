import { expect, test, type Locator, type Page } from '@playwright/test'

// S15 상단 탭 MDI — 메뉴·대화를 탭으로 열고, 탭을 바꿔도 각 화면(입력·스크롤)이 그대로 남는다
const password = 'e2e-password-1234'
async function owner(page: Page) {
  // 로그인 먼저 — 가입 409도 시도 제한 실패로 집계된다
  const login = await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })
  if (!login.ok()) expect((await page.request.post('/api/auth/signup', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
}
const strip = (page: Page) => page.getByRole('tablist', { name: '열린 화면' })
const tab = (page: Page, name: string | RegExp) => strip(page).getByRole('tab', { name })
const menu = (page: Page, name: string) => page.getByRole('navigation').getByRole('link', { name, exact: true })
const activePanel = (page: Page) => page.locator('[role="tabpanel"]:not([inert])')

/** 활성 탭 안에서 가장 먼저 스크롤되는 영역을 px만큼 내리고 실제 위치를 돌려준다 */
async function scrollActive(panel: Locator, top: number) {
  return panel.evaluate((root, value) => {
    const box = Array.from(root.querySelectorAll<HTMLElement>('*')).find(element => /(auto|scroll)/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 100)
    if (!box) return -1
    box.dataset.e2eScroll = '1'
    box.scrollTop = value
    return box.scrollTop
  }, top)
}

test.beforeEach(async ({ page }) => { await owner(page) })

test('메뉴를 탭으로 열고, 전환해도 입력·스크롤이 그대로다. 같은 메뉴는 기존 탭을 연다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 }) // 허브가 넘치도록
  await page.goto('/')
  await expect(strip(page).getByRole('tab')).toHaveText(['에이전트 허브'])
  await expect(activePanel(page).getByRole('heading', { name: '에이전트 허브' })).toBeVisible()
  const scrolled = await scrollActive(activePanel(page), 160)
  expect(scrolled).toBeGreaterThan(0)

  await menu(page, '에이전트 관리').click()
  await expect(page).toHaveURL(/\/assistants\/manage$/)
  await expect(tab(page, '에이전트 관리')).toHaveAttribute('aria-selected', 'true')
  await activePanel(page).getByLabel('에이전트 검색').fill('탭 전환 확인')
  await expect(page).toHaveTitle('에이전트 관리 · MES Agent Hub')

  await menu(page, '에이전트 허브').click()
  await expect(tab(page, '에이전트 허브')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.locator('[data-e2e-scroll]').evaluate(element => element.scrollTop)).toBe(scrolled)

  await tab(page, '에이전트 관리').click()
  await expect(page).toHaveURL(/\/assistants\/manage$/)
  await expect(activePanel(page).getByLabel('에이전트 검색')).toHaveValue('탭 전환 확인')
  await menu(page, '에이전트 관리').click()
  await expect(strip(page).getByRole('tab')).toHaveCount(2)
})

test('대화 탭은 코드·제목으로 보이고, 새로고침해도 탭이 남는다', async ({ page }) => {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: 'MDI 탭 대화' } })).json() as { id: string; code: string }
  await page.goto('/')
  await page.goto(`/c/${task.id}`)
  const chip = tab(page, `${task.code} · MDI 탭 대화`)
  await expect(chip).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveTitle(`${task.code} · MDI 탭 대화 · MES Agent Hub`)
  await page.reload()
  await expect(strip(page).getByRole('tab')).toHaveText(['에이전트 허브', `${task.code} · MDI 탭 대화`])
  await tab(page, '에이전트 허브').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(chip).toHaveAttribute('aria-selected', 'false')
})

test('살려 두는 화면은 8개 — 넘치면 오래 안 본 화면부터 내리고 탭 칩은 남긴다', async ({ page }) => {
  await page.goto('/')
  for (const name of ['내 작업', 'SR 처리', '리포트', '내 SR 요청', '에이전트 관리', '전역 설정', '사용자 관리', '연결 진단']) {
    await menu(page, name).click()
    await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true')
  }
  await expect(strip(page).getByRole('tab')).toHaveCount(9)
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(8)
  await expect(page.locator('[role="tabpanel"][aria-labelledby="tab-0"]')).toHaveCount(0) // 가장 오래 안 본 허브
  await tab(page, '에이전트 허브').click()
  await expect(activePanel(page).getByRole('heading', { name: '에이전트 허브' })).toBeVisible()
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(8)
})

test('뒤로·앞으로가기는 탭을 오가고, ×·가운데 클릭·우클릭 메뉴로 닫는다(홈은 고정)', async ({ page }) => {
  await page.goto('/')
  for (const name of ['내 작업', '리포트', 'SR 처리']) await menu(page, name).click()
  await expect(tab(page, 'SR 처리')).toHaveAttribute('aria-selected', 'true')

  await page.goBack()
  await expect(page).toHaveURL(/\/reports$/)
  await expect(tab(page, '리포트')).toHaveAttribute('aria-selected', 'true')
  await page.goForward()
  await expect(tab(page, 'SR 처리')).toHaveAttribute('aria-selected', 'true')

  await strip(page).getByTitle('SR 처리 닫기 (Delete)').click()
  await expect(page).toHaveURL(/\/reports$/) // 오른쪽이 없으면 왼쪽 이웃
  await tab(page, '내 작업').click({ button: 'middle' })
  await expect(strip(page).getByRole('tab')).toHaveText(['에이전트 허브', '리포트'])
  await expect(page).toHaveURL(/\/reports$/)

  await menu(page, '내 작업').click()
  await tab(page, '리포트').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '다른 탭 닫기' }).click()
  await expect(strip(page).getByRole('tab')).toHaveText(['에이전트 허브', '리포트'])
  await expect(page).toHaveURL(/\/reports$/)

  await tab(page, '리포트').press('ArrowLeft')
  await expect(page).toHaveURL(/\/$/)
  await expect(tab(page, '에이전트 허브')).toBeFocused()
  await expect(strip(page).getByTitle(/에이전트 허브 닫기/)).toHaveCount(0)
  await tab(page, '리포트').press('Delete')
  await expect(strip(page).getByRole('tab')).toHaveText(['에이전트 허브'])
  await expect(page).toHaveURL(/\/$/)
})

test('좁은 화면(<768px)에서는 탭 줄 없이 지금처럼 화면 하나만 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '에이전트 허브' })).toBeVisible()
  await expect(strip(page)).toHaveCount(0)
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(0)
})
