import { expect, test, type Locator, type Page } from '@playwright/test'

const password = 'e2e-password-1234'
async function signUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-guide-${crypto.randomUUID().slice(0, 12)}`)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill('가이드 사용자')
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  return (await (await page.request.get('/api/me')).json()).id as string
}
async function createTask(page: Page) {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  return (await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json()) as { id: string }
}
const PAD = 4
/** 스포트라이트가 대상 rect를 4px 여백으로 감싼다 — 부드러운 스크롤이 끝날 때까지 기다린다 */
async function expectSpotlightAround(page: Page, target: Locator) {
  await expect.poll(async () => {
    const [spot, box] = await Promise.all([page.getByTestId('tour-spotlight').boundingBox(), target.boundingBox()])
    if (!spot || !box) return null
    return [Math.round(spot.x - box.x), Math.round(spot.y - box.y), Math.round(spot.width - box.width), Math.round(spot.height - box.height)]
  }).toEqual([-PAD, -PAD, PAD * 2, PAD * 2])
}
const guide = (page: Page) => page.getByRole('dialog', { name: '페이지 가이드' })
const offer = (page: Page) => page.getByRole('status', { name: 'AI 도우미 가이드 제안' })

test('첫 진입 말풍선 → 가이드: 실제 컨트롤을 파란 테두리로 강조하고 Enter·이전·Esc로 움직이며 닫히면 포커스가 알약으로 돌아간다. AI 호출 없음', async ({ page }) => {
  const userId = await signUp(page)
  const writes: string[] = []
  page.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(new URL(request.url()).pathname) })
  await expect(offer(page).getByText('이 화면에서 도와드릴까요?')).toBeVisible()
  expect(await page.evaluate(id => localStorage.getItem(`tutorial:${id}:hub:v1`), userId)).toBe('asked')
  await offer(page).getByRole('button', { name: '네, 가이드해 주세요' }).click()
  expect(await page.evaluate(id => localStorage.getItem(`tutorial:${id}:hub:v1`), userId)).toBe('accepted')
  await expect(offer(page).getByText('이 화면에서 도와드릴까요?')).toHaveCount(0)
  const dialog = guide(page)
  await expect(dialog).toBeVisible()
  await expect(dialog).toBeFocused()
  await expect(dialog.getByText(/^1\/\d+$/)).toBeVisible()
  await expect(dialog.getByText(/에이전트 카드와 전체 대화 칸반/)).toBeVisible()
  await expectSpotlightAround(page, page.getByRole('tablist', { name: '보기 전환' }))
  await expect(page.getByTestId('tour-spotlight')).toHaveCSS('border-top-color', await page.locator('[data-testid="assistant-pill"]').evaluate(el => getComputedStyle(el).backgroundColor)) // primary = 알약 색
  await expect(dialog.getByRole('button', { name: '이전' })).toBeDisabled()
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(/^2\/\d+$/)).toBeVisible()
  await expect(dialog.getByText(/이름·요약·업무 분류로 에이전트를 찾습니다/)).toBeVisible()
  await expectSpotlightAround(page, page.getByRole('textbox', { name: '이름 · 요약 · 업무 분류 검색', exact: true }))
  await dialog.getByRole('button', { name: '이전' }).click()
  await expect(dialog.getByText(/^1\/\d+$/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('tour-spotlight')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 도우미 열기' })).toBeFocused()
  expect(writes).toEqual([])
})

test('창의 "가이드해 주세요"는 창을 닫고 투어를 시작한다; 대화 페이지에서는 없는 대상(같은 태그 패널)을 건너뛰고 마지막은 알약이다', async ({ page }) => {
  await signUp(page)
  const task = await createTask(page) // 태그 없음 → 같은 태그 패널 없음
  await page.goto(`/c/${task.id}`)
  await offer(page).getByRole('button', { name: '괜찮아요' }).click()
  await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
  const window = page.getByRole('dialog', { name: '시스템 assistant' })
  const actions = window.getByRole('region', { name: '할 수 있는 것' }).getByRole('button')
  await expect(actions.first()).toHaveText('가이드해 주세요')
  await actions.first().click()
  await expect(window).toHaveCount(0)
  const dialog = guide(page)
  await expect(dialog.getByText('1/3')).toBeVisible() // composer · task-tabs · pill — related 없음
  await expect(dialog.getByText(/메시지를 쓰고 파일을 첨부해 보냅니다/)).toBeVisible()
  await page.keyboard.press('Space')
  await expect(dialog.getByText('2/3')).toBeVisible()
  await expectSpotlightAround(page, page.getByRole('tablist', { name: '보조 패널' }))
  await page.keyboard.press('Enter')
  await expect(dialog.getByText('3/3')).toBeVisible()
  await expectSpotlightAround(page, page.getByRole('button', { name: 'AI 도우미 열기' }))
  await expect(dialog.getByRole('button', { name: '다음' })).toHaveCount(0)
  await dialog.getByRole('button', { name: '마치기' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 도우미 열기' })).toBeFocused()
})

test.describe('390px', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('카드는 아래 여백에 고정되고 대상과 겹치지 않는다; 알약이 대상이면 위로 간다', async ({ page }) => {
    await signUp(page)
    await offer(page).getByRole('button', { name: '네, 가이드해 주세요' }).click()
    const dialog = guide(page)
    await expect(dialog).toBeVisible()
    const card = (await dialog.boundingBox())!
    expect(Math.round(card.x)).toBe(8)
    expect(Math.round(card.x + card.width)).toBe(390 - 8)
    expect(Math.round(card.y + card.height)).toBe(844 - 8)
    const spot = (await page.getByTestId('tour-spotlight').boundingBox())!
    expect(spot.y + spot.height).toBeLessThanOrEqual(card.y)
    const total = Number((await dialog.getByText(/^1\/(\d+)$/).textContent())!.split('/')[1])
    for (let step = 1; step < total; step++) await page.keyboard.press('Enter')
    await expect(dialog.getByText(`${total}/${total}`)).toBeVisible()
    await expectSpotlightAround(page, page.getByRole('button', { name: 'AI 도우미 열기' }))
    const top = (await dialog.boundingBox())!
    expect(Math.round(top.y)).toBe(8) // 알약은 화면 아래 → 카드가 위로
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  })
})
