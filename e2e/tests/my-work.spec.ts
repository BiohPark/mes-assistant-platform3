import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const password = 'e2e-password-1234'
const uniqueId = () => `e2e-mw-${randomUUID().slice(0, 18)}`

interface Assistant { id: string; name: string; status: string }
interface Conversation {
  id: string
  code: string
  title: string
  status: 'todo' | 'in_progress' | 'on_hold' | 'done'
  ownerId: string
  assigneeIds: string[]
  createdBy: string
  lastActivityAt: string
}
interface ConversationInput {
  assistantId: string
  title: string
  tags: string[]
  ownerId?: string
  assigneeIds?: string[]
}

async function signUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(uniqueId())
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill('내 작업 E2E 사용자')
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  // 허브에 도착한 뒤 이동해야 실제 세션 쿠키가 적용된다.
  await expect(page).toHaveURL(/\/$/)
  const me = await page.request.get('/api/me')
  expect(me.ok()).toBe(true)
  return await me.json() as { id: string; roles: string[] }
}

async function getAssistant(api: APIRequestContext) {
  const response = await api.get('/api/assistants')
  expect(response.ok()).toBe(true)
  const assistants = await response.json() as Assistant[]
  const assistant = assistants.find(row => row.status !== 'retired')
  expect(assistant).toBeDefined()
  return assistant!
}

async function createConversation(api: APIRequestContext, data: ConversationInput) {
  const response = await api.post('/api/tasks', { data })
  expect(response.status(), await response.text()).toBe(201)
  return await response.json() as Conversation
}

async function setStatus(api: APIRequestContext, task: Conversation, status: Conversation['status']) {
  const response = await api.post(`/api/tasks/${task.id}/status`, { data: { status, reason: '내 작업 E2E 상태 변경' } })
  expect(response.ok(), await response.text()).toBe(true)
  const updated = await response.json() as Conversation
  expect(updated.status).toBe(status)
  return updated
}

for (const role of ['member', 'system_owner'] as const) {
  test(`${role}: 내 작업 메뉴, 담당·참여 판정, 상태와 활동 정렬`, async ({ page, browser, playwright, baseURL }) => {
    const me = await signUp(page)
    if (role === 'system_owner') {
      const admin = await playwright.request.newContext({ baseURL })
      try {
        expect((await admin.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
        expect((await admin.put(`/api/users/${me.id}/system-owner`, { data: { enabled: true } })).status()).toBe(204)
        // BO를 겸하는 SO도 업무 메뉴에 접근할 수 있다.
        expect((await admin.put(`/api/users/${me.id}/business-owner`, { data: { enabled: true } })).status()).toBe(204)
      } finally { await admin.dispose() }
      const updated = await (await page.request.get('/api/me')).json() as { roles: string[] }
      expect(updated.roles).toEqual(expect.arrayContaining(['system_owner', 'requester']))
    }

    const other = await browser.newContext({ baseURL })
    try {
      const signup = await other.request.post('/api/auth/signup', { data: { loginId: uniqueId(), name: '다른 작업 담당자', password } })
      expect(signup.ok()).toBe(true)
      const otherId = ((await signup.json()) as { id: string }).id
      const assistant = await getAssistant(page.request)
      const tag = uniqueId()
      const srTag = 'SR-2026-0001'
      const input = { assistantId: assistant.id, tags: [tag, srTag] }
      const todo = await setStatus(page.request, await createConversation(page.request, { ...input, title: `${tag} 대기`, assigneeIds: [] }), 'todo')
      expect(todo.ownerId).toBe(me.id)
      expect(todo.assigneeIds).toEqual([]) // 소유자만 일치해도 mine이다.
      let participant = await createConversation(other.request, { ...input, title: `${tag} 참여`, assigneeIds: [me.id] })
      expect(participant.ownerId).toBe(otherId)
      expect(participant.createdBy).toBe(otherId)
      expect(participant.assigneeIds).toEqual([me.id])
      const progress = await createConversation(page.request, { ...input, title: `${tag} 진행` })
      const unrelated = await createConversation(other.request, { ...input, title: `${tag} 다른 사용자` })
      const creatorOnly = await createConversation(page.request, { ...input, title: `${tag} 생성만`, ownerId: otherId, assigneeIds: [otherId] })
      expect(creatorOnly.createdBy).toBe(me.id)
      // 먼저 생성한 참여 대화를 나중에 갱신하여 생성순이 아닌 활동순을 검증한다.
      participant = await setStatus(other.request, participant, 'on_hold')
      const done = await setStatus(page.request, await createConversation(page.request, { ...input, title: `${tag} 완료` }), 'done')
      expect(participant.lastActivityAt > progress.lastActivityAt).toBe(true)
      expect(progress.lastActivityAt > todo.lastActivityAt).toBe(true)
      expect(done.lastActivityAt > participant.lastActivityAt).toBe(true)

      await page.goto('/my-work')
      await expect(page.getByRole('heading', { name: '내 작업', exact: true })).toBeVisible()
      await expect(page.getByRole('navigation').and(page.locator('[data-tour="nav"]')).getByRole('link', { name: '내 작업', exact: true })).toHaveAttribute('aria-current', 'page')
      await page.getByRole('textbox', { name: '내 작업 검색' }).fill(tag)
      const list = page.locator('[data-tour="my-work-list"]')
      // DB를 공유하는 다른 spec의 대화는 개수·순서 단언에서 제외한다.
      const rows = list.getByRole('link').filter({ hasText: tag })
      await expect(rows).toHaveCount(3)
      for (const [index, task] of [participant, progress, todo].entries()) {
        const row = rows.nth(index)
        await expect(row).toHaveAttribute('href', `/c/${task.id}`)
        await expect(row.getByText(task.code, { exact: true })).toBeVisible()
        await expect(row.getByText(task.title, { exact: true })).toBeVisible()
        await expect(row.getByText(assistant.name, { exact: true })).toBeVisible()
        await expect(row.locator('time')).toHaveAttribute('datetime', task.lastActivityAt)
      }
      for (const status of ['대기', '진행 중', '보류']) await expect(rows.getByText(status, { exact: true })).toBeVisible()
      for (const task of [unrelated, creatorOnly, done]) await expect(list.locator(`a[href="/c/${task.id}"]`)).toHaveCount(0)

      const completedTab = page.getByRole('tab', { name: '완료', exact: true })
      const activeTab = page.getByRole('tab', { name: '진행·보류', exact: true })
      await expect(activeTab).toHaveAttribute('aria-selected', 'true')
      await completedTab.focus()
      await page.keyboard.press('Space')
      await expect(completedTab).toHaveAttribute('aria-selected', 'true')
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toHaveAttribute('href', `/c/${done.id}`)
      await expect.poll(() => new URL(page.url()).searchParams.get('done')).toBe('1')
      await page.reload()
      await expect(completedTab).toHaveAttribute('aria-selected', 'true')
      await expect(rows).toHaveCount(1)
      await rows.first().focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(new RegExp(`/c/${done.id}$`))
      await page.goBack()
      await expect(completedTab).toHaveAttribute('aria-selected', 'true')
      await expect(rows).toHaveCount(1)
      await activeTab.click()
      await expect(activeTab).toHaveAttribute('aria-selected', 'true')
      await expect.poll(() => new URL(page.url()).searchParams.has('done')).toBe(false)
      await expect(rows).toHaveCount(3)
      await expect(list.locator(`a[href="/c/${done.id}"]`)).toHaveCount(0)
      await rows.first().focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(new RegExp(`/c/${participant.id}$`))
    } finally { await other.close() }
  })
}

test('BO는 내 작업 메뉴를 보지 않고 /sr로 이동하며 작업 쿼리를 호출하지 않는다', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('ID').fill('dev-requester')
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page).toHaveURL(/\/sr$/)
  const requests: string[] = []
  page.on('request', request => requests.push(new URL(request.url()).pathname))
  await page.goto('/my-work')
  await expect(page).toHaveURL(/\/sr$/)
  await expect(page.getByRole('navigation').and(page.locator('[data-tour="nav"]')).getByRole('link', { name: '내 작업', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '내 SR 요청', exact: true })).toBeVisible()
  expect(requests).not.toContain('/api/tasks')
  expect(requests).not.toContain('/api/assistants')
})

test('새 사용자의 빈 목록은 새 대화를 시작할 허브로 안내한다', async ({ page }) => {
  await signUp(page)
  await page.goto('/my-work')
  await expect(page.getByText('내 작업이 없습니다', { exact: true })).toBeVisible()
  const hub = page.getByRole('link', { name: '에이전트 허브로 이동' })
  await expect(hub).toHaveAttribute('href', '/')
  await hub.click()
  await expect(page).toHaveURL(/\/$/)
})

test('영어 내 작업 제목·완료 탭·상태·최근 활동', async ({ page }) => {
  await signUp(page)
  const assistant = await getAssistant(page.request)
  const task = await createConversation(page.request, { assistantId: assistant.id, title: 'English My work conversation', tags: [uniqueId()] })
  // 프로필 PATCH는 GET /api/me와 달리 /api/users/me에 있다.
  const profile = await page.request.patch('/api/users/me', { data: { locale: 'en' } })
  expect(profile.ok()).toBe(true)
  expect((await (await page.request.get('/api/me')).json() as { locale: string }).locale).toBe('en')
  await page.goto('/my-work')
  await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation').and(page.locator('[data-tour="nav"]')).getByRole('link', { name: 'My work', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('tab', { name: 'Completed', exact: true })).toBeVisible()
  const row = page.getByRole('list', { name: 'My work conversations' }).locator(`a[href="/c/${task.id}"]`)
  await expect(row.getByText('In progress', { exact: true })).toBeVisible()
  await expect(row.locator('time')).toHaveAttribute('datetime', task.lastActivityAt)
  await expect(row.locator('time')).toContainText(/ago/)
})

test('390px에서 긴 제목이 가로 넘침 없이 표시되고 행을 열 수 있다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signUp(page)
  const assistant = await getAssistant(page.request)
  // 실제 API의 태그 길이 한도(191자) 안에서 긴 태그를 만든다.
  const longTag = 'long-tag-'.repeat(20)
  const task = await createConversation(page.request, { assistantId: assistant.id, title: '긴대화제목'.repeat(30), tags: [uniqueId(), 'SR-2026-0001', longTag] })
  await page.goto('/my-work')
  await expect(page.getByRole('heading', { name: '내 작업', exact: true })).toBeVisible()
  const row = page.getByRole('list', { name: '내 작업 대화' }).locator(`a[href="/c/${task.id}"]`)
  await expect(row).toBeVisible()
  await expect(row.getByText(task.title, { exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: '완료', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await row.click()
  await expect(page).toHaveURL(new RegExp(`/c/${task.id}$`))
})
