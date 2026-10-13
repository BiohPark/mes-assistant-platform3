import { expect, test } from '@playwright/test'

test('로그인 후 시드 카탈로그 카드·검색·Lv1 필터', async ({ page }) => {
  const loginId = `e2e-catalog-${Date.now()}`
  await page.goto('/signup')
  await page.getByLabel('ID').fill(loginId)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()

  await expect(page.getByRole('link', { name: /새 대화/ })).toHaveCount(12)
  await page.getByPlaceholder('이름 · 요약 · 업무 분류 검색').fill('프로토콜')
  await expect(page.getByRole('link', { name: /새 대화/ })).toHaveCount(1)
  await page.getByPlaceholder('이름 · 요약 · 업무 분류 검색').fill('')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ status: string; classifications: Array<{ level1: string; level2: string; level1CodeId: string; level2CodeId: string }> }>
  const recordCount = assistants.filter(a => a.status !== 'retired' && a.classifications.some(path => path.level1 === 'Record')).length
  await expect(page.getByRole('link', { name: /새 대화/ })).toHaveCount(recordCount)
  await expect(page).toHaveURL(/l1=/)
  const selectedUrl = page.url()
  await page.getByRole('tab', { name: '전체 대화 칸반' }).click()
  await expect(page).toHaveURL(/view=kanban/)
  await page.getByRole('tab', { name: '에이전트 카드' }).click()
  expect(new URL(page.url()).searchParams.getAll('l1')).toEqual(new URL(selectedUrl).searchParams.getAll('l1'))
  await page.getByRole('button', { name: 'SDLC', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'SDLC', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.goBack()
  await expect(page.getByRole('button', { name: 'SDLC', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.goForward()
  await expect(page.getByRole('button', { name: 'SDLC', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByPlaceholder('이름 · 요약 · 업무 분류 검색').fill('존재하지 않는 에이전트')
  await expect(page.getByRole('button', { name: '검색어 지우기' })).toBeVisible()
  await expect(page.getByRole('button', { name: '필터 2개 초기화' })).toBeVisible()
  await page.getByRole('button', { name: '검색어 지우기' }).click()
  await page.getByRole('button', { name: '초기화', exact: true }).click()
  await expect(page.getByRole('link', { name: /새 대화/ })).toHaveCount(12)
  await expect(page.getByRole('link', { name: /편집$/ })).toHaveCount(0)
})

test.describe('390px 카드', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('hover해도 진행 수가 남고, 요약 토글은 카드 이동 없이 여닫힌다', async ({ page }) => {
    await page.goto('/signup')
    await page.getByLabel('ID').fill(`e2e-card-${Date.now()}`)
    await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
    await page.getByLabel('이름').fill('가상 사용자')
    await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
    await page.getByRole('button', { name: '회원가입' }).click()
    const card = page.getByRole('link', { name: /새 대화/ }).first().locator('..')
    await expect(card).toBeVisible()
    const count = card.getByText('진행', { exact: false })
    await expect(count).toBeVisible()
    await card.hover()
    await expect(card.getByRole('link', { name: '대화' })).toBeVisible() // hover 액션이 떠도
    await expect(count).toBeVisible() // 진행 수는 그대로 보인다
    const toggle = card.getByRole('button', { name: /요약 펼치기$/ })
    const box = await toggle.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(32)
    expect(box!.height).toBeGreaterThanOrEqual(32)
    await toggle.click()
    await expect(page).toHaveURL(/\/$/) // 카드 링크로 넘어가지 않는다
    await expect(card.getByRole('button', { name: /요약 접기$/ })).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(() => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))).toEqual({ scroll: 390, client: 390 })
    await page.keyboard.press('Enter') // 포커스가 토글에 남아 있어 키보드로 닫힌다
    await expect(card.getByRole('button', { name: /요약 펼치기$/ })).toHaveAttribute('aria-expanded', 'false')
    await expect(page).toHaveURL(/\/$/)
  })
})
