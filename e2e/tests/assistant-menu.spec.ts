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

test('asks once per browser, including an unanswered invitation', async ({ page }) => {
  const userId = await signUp(page)
  let dialog = await open(page)
  await expect(dialog.getByText('둘러볼까요?', { exact: true })).toBeVisible()
  expect(await page.evaluate(id => localStorage.getItem(`tutorial:${id}:v1`), userId)).toBe('asked')
  await close(page)
  dialog = await open(page)
  await expect(dialog.getByText('둘러볼까요?', { exact: true })).toHaveCount(0)
  await close(page)
  await page.reload()
  dialog = await open(page)
  await expect(dialog.getByText('둘러볼까요?', { exact: true })).toHaveCount(0)
})

test('accepts one current-page step, skips and replays from My info', async ({ page }) => {
  const userId = await signUp(page)
  let dialog = await open(page)
  await dialog.getByRole('button', { name: '둘러보기', exact: true }).click()
  await expect(dialog.getByText('현재 페이지 · 1/1')).toBeVisible()
  await expect(dialog.getByText(/허브에서 에이전트를 검색/)).toBeVisible()
  expect(await page.evaluate(id => localStorage.getItem(`tutorial:${id}:v1`), userId)).toBe('accepted')
  await dialog.getByRole('button', { name: '건너뛰기' }).click()
  expect(await page.evaluate(id => localStorage.getItem(`tutorial:${id}:v1`), userId)).toBe('skipped')
  await close(page)
  await page.goto('/my-info')
  await page.getByRole('button', { name: '튜토리얼 다시 보기' }).click()
  dialog = page.getByRole('dialog', { name: '시스템 assistant' })
  await expect(dialog.getByText('현재 페이지 · 1/1')).toBeVisible()
  await expect(dialog.getByText(/내 정보에서 튜토리얼을 다시/)).toBeVisible()
  await dialog.getByRole('button', { name: '마치기' }).click()
  await expect(dialog.getByText('현재 페이지 · 1/1')).toHaveCount(0)
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
  let dialog = await open(page)
  await expect(dialog.getByText('둘러볼까요?', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '건너뛰기' }).click()
  await close(page)
  await page.goto('/my-info')
  dialog = await open(page)
  await expect(dialog.getByText('둘러볼까요?', { exact: true })).toHaveCount(0)
  await close(page)
  await page.reload()
  dialog = await open(page)
  await expect(dialog.getByText('둘러볼까요?', { exact: true })).toHaveCount(0)
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
