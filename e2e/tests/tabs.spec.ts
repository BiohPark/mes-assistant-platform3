/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test'
import { linkedMaterialsToggle, revealMaterials } from './materials.js'

// S15 상단 탭 MDI — 메뉴·대화를 탭으로 열고, 탭을 바꿔도 각 화면(입력·스크롤)이 그대로 남는다
const password = 'e2e-password-1234'
async function owner(page: Page) {
  // 로그인 먼저 — 가입 409도 시도 제한 실패로 집계된다
  const login = await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })
  if (!login.ok()) expect((await page.request.post('/api/auth/signup', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
}
const strip = (page: Page) => page.getByRole('tablist', { name: '열린 화면' })
const tab = (page: Page, name: string | RegExp) => strip(page).getByRole('tab', { name })
const menu = (page: Page, name: string) => page.getByRole('navigation').and(page.locator('[data-tour="nav"]')).getByRole('link', { name, exact: true })
const activePanel = (page: Page) => page.locator('[data-tab-panel]:not([inert])')

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

test.beforeEach(async ({ page }) => {
  await owner(page)
  // 이 spec은 탭 이동/LRU를 검증한다. 누적 가입자 전체(직렬 실패 trace: 10,832행)의
  // 관리 폼 렌더가 이동을 막지 않도록, 실제 응답 중 한 화면 분량만 제공한다.
  await page.route('**/api/users', async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const users = await response.json() as unknown[]
    await route.fulfill({ response, json: users.slice(0, 10) })
  })
})
// 테스트가 끝날 때 아직 진행 중인 위 route.fetch는 'Test ended'로 거부되어 이 테스트(또는 같은 워커의 다음 테스트) 실패로 잡힌다
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }) })

test('메뉴를 탭으로 열고, 전환해도 입력·스크롤이 그대로다. 같은 메뉴는 기존 탭을 연다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 }) // 허브가 넘치도록
  await page.goto('/')
  await expect(strip(page).getByRole('tab')).toHaveText(['에이전트 허브'])
  await expect(activePanel(page).getByRole('heading', { name: '에이전트 허브' })).toBeVisible()
  // 제목은 목록 로드 전에 그려진다. 부하에서 아직 '불러오는 중…'이면 넘치는 영역이 없거나(-1), 위쪽 '이어하기' 줄이 로드되며
  // 높아져 스크롤 앵커링이 위치를 옮긴다(160→170) — 허브의 두 목록 로드가 끝난 뒤 스크롤한다
  await expect(activePanel(page).getByText('불러오는 중…', { exact: true })).toHaveCount(0)
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
  for (const name of ['내 작업', '리포트', 'SR 처리']) {
    await menu(page, name).click()
    await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true') // 부하에서 연속 클릭이 이동 전에 겹치지 않게
  }
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
  await tab(page, '리포트').focus()
  await tab(page, '리포트').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '다른 탭 닫기' }).click()
  // Radix FocusScope는 메뉴가 닫히면 setTimeout(0)으로 열기 전 포커스(리포트)를 복원한다. 이미 리포트에 포커스가 있어
  // toBeFocused로는 복원 완료를 알 수 없으므로, 메뉴가 사라진 뒤 그 뒤 순번의 0ms 타이머를 기다려 복원이 끝났음을 보장한다
  // (안 그러면 아래 ArrowLeft가 옮긴 포커스를 늦은 복원이 다시 리포트로 빼앗는다)
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)))
  await expect(strip(page).getByRole('tab')).toHaveText(['에이전트 허브', '리포트'])
  await expect(page).toHaveURL(/\/reports$/)
  await expect(tab(page, '리포트')).toBeFocused()

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

test('응답 중인 대화가 화면에서 내려갔다 다시 열려도 같은 요청에 한 번만 다시 붙고 답은 하나다', async ({ page }) => {
  test.slow() // 살려 둔 화면 9개를 병렬 부하에서 개발 빌드로 그린다
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: 'MDI 퇴거 대화' } })).json() as { id: string; code: string; threadId: string }
  const posts: string[] = []
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/api/threads/${task.threadId}/requests`)) posts.push(request.headers()['idempotency-key'] ?? '') })
  await page.goto(`/c/${task.id}`)
  await activePanel(page).getByRole('textbox', { name: 'AI 요청 입력' }).fill('탭을 오가는 동안 답해 주세요')
  await activePanel(page).getByRole('button', { name: '전송', exact: true }).click()
  const taskPanelId = await tab(page, `${task.code} · MDI 퇴거 대화`).getAttribute('aria-controls')
  // 다른 화면 8개를 열어 대화 화면을 내린다(응답 중이든 끝났든). 집계가 무거운 리포트 대신 이미 열린 허브를 다시 본다
  for (const name of ['에이전트 허브', '내 작업', 'SR 처리', '내 SR 요청', '에이전트 관리', '전역 설정', '사용자 관리', '연결 진단']) {
    await menu(page, name).click()
    await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true') // 부하에서 연속 클릭이 이동 전에 겹치지 않게
  }
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(8)
  await expect(page.locator(`[id="${taskPanelId}"]`)).toHaveCount(0) // 실제 퇴거 뒤 재마운트해야 한다
  await tab(page, `${task.code} · MDI 퇴거 대화`).click()
  await expect.poll(async () => {
    const messages = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Array<{ role: string; status: string }>
    return messages.filter(row => row.role === 'assistant').map(row => row.status)
  }, { timeout: 30_000 }).toEqual(['done'])
  // 살아 있는 화면이 9개라 병렬 부하에서는 개발 빌드 렌더가 느리다 — 화면 확인은 넉넉히 기다린다
  await expect(activePanel(page).getByTestId('chat-message-scroll').getByText('탭을 오가는 동안 답해 주세요').first()).toBeVisible({ timeout: 30_000 })
  await expect(activePanel(page).getByRole('button', { name: '전송', exact: true })).toBeVisible({ timeout: 30_000 })
  // 응답 중에 내려갔다면 다시 열 때 같은 시도(키)로 다시 붙는다(개발 StrictMode는 마운트 때 한 번 더 붙었다 끊는다) — 새 요청은 없다
  expect(posts.length).toBeGreaterThanOrEqual(1)
  expect(new Set(posts).size).toBe(1)
})

test('대화 두 개를 함께 열어도 보조 패널 탭·패널 id가 겹치지 않는다', async ({ page }) => {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const create = async (title: string) => (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title, tags: ['MDI-context'] } })).json() as Promise<{ id: string; code: string }>
  const first = await create('MDI id 하나')
  const second = await create('MDI id 둘')
  await page.goto(`/c/${first.id}`)
  await expect(tab(page, `${first.code} · MDI id 하나`)).toHaveAttribute('aria-selected', 'true')
  await page.goto('/')
  await page.goto(`/c/${second.id}`)
  await tab(page, `${first.code} · MDI id 하나`).click()
  await tab(page, `${second.code} · MDI id 둘`).click()
  await expect(page.locator('[data-tab-panel]').filter({ has: page.getByRole('complementary', { name: '#태그·SR 연결 자료', includeHidden: true }) })).toHaveCount(2)
  const ids = await page.locator('[id^="work-panel-"], [id^="work-tab-"]').evaluateAll(elements => elements.map(element => element.id))
  expect(ids.length).toBeGreaterThan(0)
  expect(new Set(ids).size).toBe(ids.length)
  await expect(tab(page, `${second.code} · MDI id 둘`)).toHaveAttribute('aria-selected', 'true')
  // 보이는 대화의 선택된 보조 탭이 가리키는 패널은 같은 대화 안에 있고, 그 패널은 이 탭으로 이름 붙는다
  const linked = await linkedMaterialsToggle(activePanel(page)).evaluate(toggle => {
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    return !!panel && panel.closest('[role="tabpanel"][data-tab-panel]') === toggle.closest('[role="tabpanel"][data-tab-panel]')
  })
  expect(linked).toBe(true)
})

test('공유 안내 처리→수동 닫힘→다른 화면 8개로 LRU 퇴거→복귀해도 닫힘을 유지한다', async ({ page }) => {
  test.slow()
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const tagName = `LRU-share-${Date.now()}`
  const source = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, tags: [tagName] } })).json() as { id: string }
  const target = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title: '공유 안내 LRU' } })).json() as { id: string; code: string }
  expect((await page.request.post('/api/files', { multipart: { originTaskId: source.id, file: { name: 'lru.txt', mimeType: 'text/plain', buffer: Buffer.from('공유 자료') } } })).ok()).toBe(true)
  await page.goto(`/c/${target.id}`)
  const taskTab = tab(page, `${target.code} · 공유 안내 LRU`)
  await expect(taskTab).toHaveAttribute('aria-selected', 'true')
  await activePanel(page).getByRole('button', { name: '태그 추가' }).click()
  // 태그 팝오버는 활성 tabpanel의 자식이 아니라 body 포털에 열린다.
  const input = page.getByRole('dialog', { name: '태그 추가' }).getByRole('combobox', { name: '태그 입력' })
  await input.fill(tagName)
  await input.press('Enter')
  await expect(input).toHaveAttribute('aria-busy', 'false')
  await expect(activePanel(page).getByRole('button', { name: `${tagName} 태그 제거`, exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(input).toBeHidden()
  await revealMaterials(page)
  const toggle = linkedMaterialsToggle(activePanel(page))
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(activePanel(page).getByRole('tab', { name: '자료', exact: true })).toBeFocused()
  await expect(activePanel(page).getByTestId('materials-shared')).toContainText('lru.txt')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const panelId = await taskTab.getAttribute('aria-controls')
  for (const name of ['에이전트 허브', '내 작업', 'SR 처리', '내 SR 요청', '에이전트 관리', '전역 설정', '사용자 관리', '연결 진단']) {
    await menu(page, name).click()
    await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true')
  }
  await expect(page.locator(`[id="${panelId}"]`)).toHaveCount(0)
  await taskTab.click()
  await expect(taskTab).toHaveAttribute('aria-selected', 'true')
  await expect(activePanel(page).getByRole('textbox', { name: 'AI 요청 입력' })).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(activePanel(page).getByRole('complementary', { name: '#태그·SR 연결 자료' })).toHaveCount(0)
})

test('업무 레일은 MDI에서 내려갔다 다시 열려도 펼침·마지막 탭·작성 중 초안·스크롤을 되살린다', async ({ page }) => {
  test.slow() // 살려 둔 화면 9개를 병렬 부하에서 개발 빌드로 그린다
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants.find(item => item.status === 'open')!.id, title: '레일 퇴거 대화' } })).json() as { id: string; code: string }
  for (let index = 1; index <= 30; index++) {
    expect((await page.request.post(`/api/tasks/${task.id}/notes`, { data: { content: `레일 스크롤 메모 ${index}\n${'긴 줄 '.repeat(20)}`, attachmentIds: [] } })).ok()).toBe(true)
  }
  await page.goto(`/c/${task.id}`)
  const rail = activePanel(page).getByRole('navigation', { name: '업무 도구' })
  await rail.getByRole('button', { name: /^메모/ }).click()
  const notesPanel = activePanel(page).getByRole('tabpanel', { name: '메모' })
  await expect(notesPanel.getByText('레일 스크롤 메모 30')).toBeVisible()
  await activePanel(page).getByRole('textbox', { name: '메모 본문' }).fill('퇴거 뒤에도 남을 초안')
  const scrolled = await notesPanel.evaluate(node => { node.scrollTop = 400; node.dispatchEvent(new Event('scroll')); return node.scrollTop })
  expect(scrolled).toBeGreaterThan(0)
  const taskPanelId = await tab(page, `${task.code} · 레일 퇴거 대화`).getAttribute('aria-controls')
  for (const name of ['에이전트 허브', '내 작업', 'SR 처리', '내 SR 요청', '에이전트 관리', '전역 설정', '사용자 관리', '연결 진단']) {
    await menu(page, name).click()
    await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true')
  }
  await expect(page.locator(`[id="${taskPanelId}"]`)).toHaveCount(0) // 실제 퇴거 — 다시 열면 새로 마운트한다
  await tab(page, `${task.code} · 레일 퇴거 대화`).click()
  const restored = activePanel(page)
  await expect(restored.getByRole('navigation', { name: '업무 도구' }).getByRole('button', { name: /^메모/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(restored.getByRole('tab', { name: '메모', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(restored.getByRole('textbox', { name: '메모 본문' })).toHaveValue('퇴거 뒤에도 남을 초안')
  await expect(restored.getByRole('tabpanel', { name: '메모' }).getByText('레일 스크롤 메모 30')).toBeVisible()
  await expect.poll(() => restored.getByRole('tabpanel', { name: '메모' }).evaluate(node => node.scrollTop)).toBe(scrolled)
})
