import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1234'
async function signUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-tourplus-${crypto.randomUUID().slice(0, 12)}`)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill('투어 사용자')
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}
/** E2E 서버가 dev-owner를 시드한다(admin.spec과 같은 이유로 가입 대신 바로 로그인) */
async function loginOwner(page: Page) {
  expect((await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
  expect((await (await page.request.get('/api/me')).json()).roles).toContain('system_owner')
}
async function createTask(page: Page) {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const created = await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: '투어 대화' } })
  expect(created.ok()).toBe(true)
  return { ...(await created.json()) as { id: string; code: string }, assistantId: assistants[0]!.id }
}
const PAD = 4
async function expectSpotlightAround(page: Page, target: ReturnType<Page['locator']>) {
  await expect.poll(async () => {
    const [spot, box] = await Promise.all([page.getByTestId('tour-spotlight').boundingBox(), target.boundingBox()])
    if (!spot || !box) return null
    return [Math.round(spot.x - box.x), Math.round(spot.y - box.y), Math.round(spot.width - box.width), Math.round(spot.height - box.height)]
  }).toEqual([-PAD, -PAD, PAD * 2, PAD * 2])
}
const guide = (page: Page) => page.getByRole('dialog', { name: '페이지 가이드' })
/** 도우미 창의 첫 빠른 실행 = 가이드 */
async function startGuideFromWindow(page: Page) {
  await page.getByRole('button', { name: 'AI 도우미 열기' }).click()
  await page.getByRole('dialog', { name: '시스템 assistant' }).getByRole('region', { name: '할 수 있는 것' }).getByRole('button').first().click()
}

test('칸반 보드 섹션: 허브 섹션 다음에 필터·AI 상태 칩·열·카드를 차례로 짚는다', async ({ page }) => {
  await signUp(page)
  const task = await createTask(page)
  await page.goto('/?view=kanban&mine=1')
  await expect(page.getByRole('link', { name: new RegExp(task.code) })).toBeVisible()
  await startGuideFromWindow(page)
  const dialog = guide(page)
  await expect(dialog.getByRole('heading', { name: '에이전트 허브' })).toBeVisible() // 칸반 보기에서도 보기 전환은 있다
  await dialog.getByRole('button', { name: '이 섹션 건너뛰기' }).click()
  await expect(dialog.getByRole('heading', { name: '칸반 보드' })).toBeVisible()
  await expect(dialog.getByText(/검색·단계·상태·내 것·태그로 대화를 걸러 봅니다/)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(/AI 상태 칩입니다/)).toBeVisible()
  await expectSpotlightAround(page, page.getByRole('group', { name: 'AI 상태 필터' }))
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(/에이전트별 대화 열입니다/)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(/대화 카드입니다/)).toBeVisible()
  await expectSpotlightAround(page, page.locator('.group', { has: page.getByRole('link', { name: new RegExp(task.code) }) }))
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('모델 선택 팝오버 — 일반 사용자: 이 대화에만 적용 안내 + 담당자·System Owner가 바꾼다는 안내, 설정 열기 버튼은 없다', async ({ page }) => {
  await signUp(page)
  const task = await createTask(page)
  await page.goto(`/c/${task.id}`)
  await page.getByTitle('이 대화의 모델 변경').click()
  const popup = page.getByRole('dialog', { name: 'AI 모델' })
  await expect(popup.getByText('여기서 바꾼 AI 모델은 이 대화에만 적용돼요.')).toBeVisible()
  await expect(popup.getByText(/System Owner가 바꿔요\.$/)).toBeVisible()
  await expect(popup.getByRole('button', { name: '에이전트 설정 열기' })).toHaveCount(0)
})

test('모델 선택 팝오버 — System Owner: [에이전트 설정 열기] → 에이전트 관리에서 편집 시트가 열리고 연결 모델을 "여기예요"로 짚으며, 처음 여는 시트에는 상세 가이드가 펼쳐져 있다', async ({ page }) => {
  await loginOwner(page)
  const task = await createTask(page)
  await page.goto(`/c/${task.id}`)
  await page.getByTitle('이 대화의 모델 변경').click()
  const popup = page.getByRole('dialog', { name: 'AI 모델' })
  await expect(popup.getByText('에이전트 설정 자체를 바꾸고 싶으세요?')).toBeVisible()
  await popup.getByRole('button', { name: '에이전트 설정 열기' }).click()
  await expect(page).toHaveURL(new RegExp(`/assistants/manage\\?edit=${task.assistantId}&point=model$`))
  const sheet = page.getByRole('dialog', { name: '에이전트 편집' })
  await expect(sheet).toBeVisible()
  const marker = sheet.getByTestId('here-marker')
  await expect(marker).toHaveCount(1)
  await expect(marker.getByLabel('연결 모델')).toBeVisible()
  await expect(marker.getByRole('status').filter({ hasText: '여기예요' })).toContainText('이 에이전트의 AI 모델은 여기서 바꿔요')
  const guidePanel = sheet.getByRole('region', { name: '에이전트 설정 가이드' })
  await expect(guidePanel.getByRole('button', { name: '가이드 접기' })).toHaveAttribute('aria-expanded', 'true')
  await expect(guidePanel.getByText(/연결 모델\(AI 모델\)/)).toBeVisible()
  await marker.getByRole('button', { name: '안내 닫기' }).click()
  await expect(sheet.getByTestId('here-marker')).toHaveCount(0)
  await guidePanel.getByRole('button', { name: '가이드 접기' }).click()
  await expect(guidePanel.getByRole('button', { name: '가이드 보기' })).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL(/\/assistants\/manage$/) // edit·point 파라미터를 지운다
})
