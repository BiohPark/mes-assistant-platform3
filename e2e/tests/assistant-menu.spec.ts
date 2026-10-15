import { expect, test, type Page } from '@playwright/test'

async function signUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-menu-${crypto.randomUUID().slice(0, 12)}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('이름').fill('메뉴 사용자')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  return (await (await page.request.get('/api/me')).json()).id as string
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
  const dialog = page.getByRole('dialog', { name: '시스템 assistant' })
  await expect(dialog).toBeVisible()
  return dialog
}
async function close(page: Page) {
  await page.getByRole('button', { name: '시스템 assistant 닫기' }).click()
  await expect(page.getByRole('dialog', { name: '시스템 assistant' })).toHaveCount(0)
}
const offer = (page: Page) => page.getByRole('status', { name: 'AI 도우미 가이드 제안' }).getByText('이 화면에서 도와드릴까요?')
const stored = (page: Page, userId: string, route: string) => page.evaluate(([id, r]) => localStorage.getItem(`tutorial:${id}:${r}:v1`), [userId, route] as const)

test('asks once per user and page with a bubble — closing without an answer counts, "No thanks" is remembered, the window does not ask again', async ({ page }) => {
  const userId = await signUp(page)
  await expect(offer(page)).toBeVisible()
  expect(await stored(page, userId, 'hub')).toBe('asked')
  await page.getByRole('button', { name: '말풍선 닫기' }).click()
  await expect(offer(page)).toHaveCount(0)
  let dialog = await open(page)
  await expect(dialog.getByText('둘러볼까요?', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('region', { name: '할 수 있는 것' }).getByRole('button').first()).toHaveText('가이드해 주세요')
  await close(page)
  await page.reload()
  await expect(page.getByRole('button', { name: 'AI 도우미 열기' })).toBeVisible()
  await expect(offer(page)).toHaveCount(0)
  await page.goto('/sr') // 다른 페이지는 따로 한 번
  await expect(offer(page)).toBeVisible()
  await page.getByRole('button', { name: '괜찮아요' }).click()
  await expect(offer(page)).toHaveCount(0)
  expect(await stored(page, userId, 'sr')).toBe('skipped')
  await page.reload()
  await expect(page.getByRole('button', { name: 'AI 도우미 열기' })).toBeVisible()
  await expect(offer(page)).toHaveCount(0)
  dialog = await open(page)
  await expect(dialog.getByText('둘러볼까요?', { exact: true })).toHaveCount(0)
})

test('replays from My info as a spotlight tour of the current page without opening the window', async ({ page }) => {
  const userId = await signUp(page)
  await page.goto('/my-info')
  await page.getByRole('button', { name: '괜찮아요' }).click()
  await page.getByRole('button', { name: '튜토리얼 다시 보기' }).click()
  await expect(page.getByRole('dialog', { name: '시스템 assistant' })).toHaveCount(0)
  const tour = page.getByRole('dialog', { name: '페이지 가이드' })
  await expect(tour.getByText('1/2', { exact: true })).toBeVisible() // '섹션 1/2'와 구분
  await expect(tour.getByText(/왼쪽 메뉴로 허브/)).toBeVisible()
  expect(await stored(page, userId, 'other')).toBe('accepted')
  await tour.getByRole('button', { name: '다음' }).click()
  await expect(tour.getByText('2/2', { exact: true })).toBeVisible()
  await tour.getByRole('button', { name: '마치기' }).click()
  await expect(tour).toHaveCount(0)
})

test('storage failure shows once per session and sessionStorage survives reload', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key.startsWith('tutorial:')) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await signUp(page)
  await expect(offer(page)).toBeVisible()
  await page.getByRole('button', { name: '괜찮아요' }).click()
  await expect(offer(page)).toHaveCount(0)
  await page.goto('/my-info')
  await expect(page.getByRole('button', { name: '튜토리얼 다시 보기' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'AI 도우미 열기' })).toBeVisible()
  await expect(offer(page)).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'AI 도우미 열기' })).toBeVisible()
  await expect(offer(page)).toHaveCount(0)
})

test('menu contains no AI call: example prefill, search focus and SR navigation', async ({ page }) => {
  await signUp(page)
  const requests: string[] = []
  page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) requests.push(new URL(request.url()).pathname)
  })
  const dialog = await open(page)
  const menu = dialog.getByRole('region', { name: '할 수 있는 것' })
  const example = menu.getByRole('button', { name: /FDS 작성 도우미로/ })
  const text = (await example.textContent())!
  await example.click()
  await expect(dialog.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue(text)
  await menu.getByRole('button', { name: '에이전트 검색', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '시스템 assistant' })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '이름 · 요약 · 업무 분류 검색', exact: true })).toBeFocused()
  await page.goto('/sr?new=1')
  const srDialog = await open(page)
  await srDialog.getByRole('region', { name: '할 수 있는 것' }).getByRole('button', { name: '내 SR 요청', exact: true }).click()
  await expect(page).toHaveURL(/\/sr$/)
  expect(requests).toEqual([])
})

test('search from kanban switches to cards and focuses the rendered search input', async ({ page }) => {
  await signUp(page)
  await page.goto('/?view=kanban&tag=keep')
  await expect(page.getByRole('tab', { name: '전체 대화 칸반' })).toHaveAttribute('aria-selected', 'true')
  const dialog = await open(page)
  await dialog.getByRole('button', { name: '에이전트 검색', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '시스템 assistant' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '에이전트 카드' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('textbox', { name: '이름 · 요약 · 업무 분류 검색', exact: true })).toBeFocused()
  expect(new URL(page.url()).searchParams.get('tag')).toBe('keep')
  expect(new URL(page.url()).searchParams.has('view')).toBe(false)
})
