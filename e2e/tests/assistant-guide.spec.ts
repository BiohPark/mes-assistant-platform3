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

test('첫 진입 [🧭 사용법 보기] → 코치: 말풍선은 하단 중앙에 고정되고 대상은 제자리에서 짚는다. ←/→·Enter·이전·Esc로 움직이며 닫히면 포커스가 알약으로 돌아간다. AI 호출 없음', async ({ page }) => {
  const userId = await signUp(page)
  const writes: string[] = []
  page.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(new URL(request.url()).pathname) })
  await expect(offer(page).getByText('이 화면, 같이 둘러볼까요?')).toBeVisible()
  expect(await page.evaluate(id => localStorage.getItem(`tutorial:${id}:hub:v1`), userId)).toBe('asked')
  await offer(page).getByRole('button', { name: '사용법 보기' }).click()
  expect(await page.evaluate(id => localStorage.getItem(`tutorial:${id}:hub:v1`), userId)).toBe('accepted')
  await expect(offer(page).getByText('이 화면, 같이 둘러볼까요?')).toHaveCount(0)
  const dialog = guide(page)
  await expect(dialog).toBeVisible()
  await expect(dialog).toBeFocused()
  await expect(dialog.getByText(/^1\/\d+$/)).toBeVisible()
  await expect(dialog.getByText(/에이전트 카드와 전체 대화 칸반/)).toBeVisible()
  await expectSpotlightAround(page, page.getByRole('tablist', { name: '보기 전환' }))
  await expect(page.getByTestId('tour-spotlight')).toHaveCSS('border-top-color', await page.locator('[data-testid="assistant-pill"]').evaluate(el => getComputedStyle(el).backgroundColor)) // primary = 알약 색
  await expect(dialog.getByRole('button', { name: '이전' })).toBeDisabled()
  const viewport = page.viewportSize()!
  const first = (await dialog.boundingBox())!
  expect(Math.round(first.y + first.height)).toBe(viewport.height - 8) // 하단
  expect(Math.abs(first.x + first.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1) // 중앙
  await page.keyboard.press('ArrowRight')
  await expect(dialog.getByText(/^2\/\d+$/)).toBeVisible()
  await expect(dialog.getByText(/이름·요약·업무 분류로 에이전트를 찾아요/)).toBeVisible()
  await expectSpotlightAround(page, page.getByRole('textbox', { name: '이름 · 요약 · 업무 분류 검색', exact: true }))
  expect(await dialog.boundingBox()).toEqual(first) // 말풍선은 대상을 따라다니지 않는다
  await page.keyboard.press('ArrowLeft')
  await expect(dialog.getByText(/^1\/\d+$/)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(/^2\/\d+$/)).toBeVisible()
  await dialog.getByRole('button', { name: '이전' }).click()
  await expect(dialog.getByText(/^1\/\d+$/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('tour-spotlight')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 도우미 열기' })).toBeFocused()
  expect(writes).toEqual([])
})

test('창의 "가이드해 주세요"는 창을 닫고 섹션 투어를 시작한다; 섹션 목록·건너뛰기·다시 보기, 완료는 사용자별로 남아 다음에는 안 본 섹션부터', async ({ page }) => {
  const userId = await signUp(page)
  const task = await createTask(page) // 태그 없음 → 같은 태그 패널 없음
  await page.goto(`/c/${task.id}`)
  await expect(page.getByRole('textbox', { name: 'AI 요청 입력' })).toBeVisible()
  await offer(page).getByRole('button', { name: '다시 묻지 않기' }).click()
  await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
  const window = page.getByRole('dialog', { name: '시스템 assistant' })
  const actions = window.getByRole('region', { name: '할 수 있는 것' }).getByRole('button')
  await expect(actions.first()).toHaveText('가이드해 주세요')
  await actions.first().click()
  await expect(window).toHaveCount(0)
  const dialog = guide(page)
  await expect(dialog.getByRole('heading', { name: '대화 기본' })).toBeVisible()
  await expect(dialog.getByText(/^1\/\d+$/)).toBeVisible()
  await expect(dialog.getByText(/여기에 쓰고, 파일을 붙여 보내요/)).toBeVisible()
  await page.keyboard.press('Space') // 같은 섹션의 다음 단계 — 모델 선택
  await expect(dialog.getByText(/^2\/\d+$/)).toBeVisible()
  await expect(dialog.getByText(/이 대화에서 쓸 AI 모델이에요/)).toBeVisible()
  await expectSpotlightAround(page, page.getByTitle('이 대화의 모델 변경'))
  // 섹션 목록: 현재 위치가 표시되고 다른 섹션으로 바로 간다
  await dialog.getByRole('button', { name: '섹션 목록' }).click()
  const list = dialog.getByRole('list', { name: '가이드 섹션' })
  for (const name of ['대화 기본', '자료함', '팀 의견', '태그·같은 태그', '보류·완료', 'AI 도우미']) await expect(list.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(list.getByRole('button', { name: '요약 카드' })).toHaveCount(0) // 새 대화에는 요약 카드가 없다 → 섹션째 건너뜀
  await expect(list.getByRole('button', { name: '대화 기본', exact: true })).toHaveAttribute('aria-current', 'step')
  await dialog.getByRole('button', { name: '이 섹션 건너뛰기' }).click()
  await expect(dialog.getByRole('heading', { name: '자료함' })).toBeVisible()
  await expectSpotlightAround(page, page.getByRole('tablist', { name: '보조 패널' }))
  await page.keyboard.press('Enter') // 자료함을 짚는다(S14: 기본 패널이 자료)
  await expect(page.getByRole('tab', { name: '자료', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByText(/\[첨부\]하면 입력창에 칩으로 붙어요/)).toBeVisible()
  await expect(dialog.getByText('자료 탭을 열었어요')).toHaveCount(0) // 넓은 화면은 자료 패널이 이미 열려 있다 — 화면을 바꾸지 않는다
  await expectSpotlightAround(page, page.getByTestId('materials-library'))
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(/같은 태그 대화도 파일처럼 \[첨부\]/)).toBeVisible() // 대화 첨부 장면
  await expectSpotlightAround(page, page.locator('[data-tour="materials-conversations"]'))
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(/붙인 자료는 입력창 위 칩으로 보여요/)).toBeVisible()
  // 첨부 칩 줄 — 아직 칩이 없는 새 대화라 앵커는 📎 버튼
  await expectSpotlightAround(page, page.getByRole('button', { name: '파일 첨부', exact: true }))
  await list.getByRole('button', { name: 'AI 도우미', exact: true }).click()
  await expectSpotlightAround(page, page.getByRole('button', { name: 'AI 도우미 열기' }))
  await expect(dialog.getByRole('button', { name: '다음' })).toHaveCount(0)
  await dialog.getByRole('button', { name: '다 봤어요' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 도우미 열기' })).toBeFocused()
  await expect(page.getByRole('status', { name: 'AI 도우미 말풍선' }).getByText(/다 봤어요! 잘하셨어요/)).toBeVisible()
  expect(await page.evaluate(id => JSON.parse(localStorage.getItem(`tour-progress:${id}:conversation:v1`) ?? '[]'), userId)).toEqual(['assistant']) // 건너뛴 섹션은 완료가 아니다
  // 다시 열면 안 본 첫 섹션(대화 기본)부터, 끝낸 섹션은 ✓ + 다시 보기
  await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
  await actions.first().click()
  await expect(dialog.getByRole('heading', { name: '대화 기본' })).toBeVisible()
  await dialog.getByRole('button', { name: '섹션 목록' }).click()
  await dialog.getByRole('list', { name: '가이드 섹션' }).getByRole('button', { name: 'AI 도우미 완료 — 다시 보기' }).click()
  await expect(dialog.getByRole('heading', { name: 'AI 도우미' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test.describe('390px', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('말풍선은 아래 여백(좌우 8px)에 고정되고 대상과 겹치지 않는다; 알약이 대상이면 위로 간다', async ({ page }) => {
    await signUp(page)
    await offer(page).getByRole('button', { name: '사용법 보기' }).click()
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
