import { expect, test, type Page } from '@playwright/test'

// S14-DD 느슨한 공유 — 태그를 넣으면 같은 태그 대화의 파일(대화 첨부·자료함 업로드·산출물)과 대화가 바로 자료함에 들어오고,
// 대화 [첨부]는 한 번에 대화 전체가 실제 요청에 실린다. 전역 SSE(/api/events)가 막힌 환경(버퍼링 프록시)에서도 그래야 한다.
const password = 'e2e-password-1234'
const live = (process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) === 'live'
type Msg = { role: string; content: string; status: string; requestId?: string }

async function signup(page: Page, suffix: string) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`share-${suffix}-${Date.now()}`.slice(0, 32))
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}
async function createTask(page: Page, tags: string[]) {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
  const active = assistants.find((item) => item.status === 'open')
  test.skip(!active, '활성 에이전트가 없어 대화를 만들 수 없습니다')
  const response = await page.request.post('/api/tasks', { data: { assistantId: active!.id, tags } })
  expect(response.ok()).toBe(true)
  return await response.json() as { id: string; code: string; threadId: string }
}
async function upload(page: Page, taskId: string, name: string) {
  const response = await page.request.post('/api/files', { multipart: { originTaskId: taskId, file: { name, mimeType: 'text/plain', buffer: Buffer.from(name) } } })
  expect(response.ok()).toBe(true)
  return (await response.json() as { id: string }).id
}
async function messages(page: Page, threadId: string) {
  return await (await page.request.get(`/api/threads/${threadId}/messages`)).json() as Msg[]
}
async function ask(page: Page, threadId: string, content: string, attachmentIds: string[] = []) {
  const result = await page.request.post(`/api/threads/${threadId}/requests`, { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { content, attachmentIds } })
  expect(result.status()).toBe(201)
  await expect.poll(async () => (await messages(page, threadId)).at(-1)?.status).toBe('done')
}
/** 같은 태그 대화 A — 대화 첨부·자료함 업로드·산출물 저장 세 경로로 파일을 남긴다 */
async function sourceConversation(page: Page, tag: string, marker: string) {
  const source = await createTask(page, [tag])
  const chatFile = await upload(page, source.id, `chat-${marker}.txt`)
  await ask(page, source.threadId, `원본 질문 ${marker}`, [chatFile])
  await upload(page, source.id, `upload-${marker}.txt`)
  expect((await page.request.post(`/api/tasks/${source.id}/outputs`, { data: { name: `output-${marker}.md`, content: `산출물 ${marker}` } })).ok()).toBe(true)
  return source
}
async function openMaterials(page: Page, taskId: string) {
  await page.goto(`/c/${taskId}`)
  await page.getByRole('tablist', { name: '보조 패널' }).getByRole('tab', { name: '자료' }).click()
}
const tagInput = (page: Page) => page.getByRole('combobox', { name: '태그 입력' })
async function addTag(page: Page, tag: string) {
  await page.getByRole('button', { name: '태그 추가' }).click()
  await tagInput(page).fill(tag)
  await tagInput(page).press('Enter')
  await page.keyboard.press('Escape')
}

test('태그를 넣으면 같은 태그 대화의 파일 세 경로와 대화가 바로 들어오고, [첨부] 한 번에 대화 전체가 요청에 실린다', async ({ page }) => {
  await signup(page, 'in')
  const marker = `DD${Date.now().toString(36)}`
  const tag = `share-${marker}`
  const source = await sourceConversation(page, tag, marker)
  const sourceReply = (await messages(page, source.threadId)).at(-1)!.content
  const consumer = await createTask(page, [])
  await page.route('**/api/events', (route) => route.abort()) // 전역 SSE 없이도 내 태그 변경은 바로 반영돼야 한다
  await openMaterials(page, consumer.id)
  const shared = page.getByTestId('materials-shared')
  await expect(shared).toContainText('같은 태그 대화의 파일이 없습니다')

  await addTag(page, tag)
  for (const name of [`chat-${marker}.txt`, `upload-${marker}.txt`, `output-${marker}.md`]) await expect(shared).toContainText(name)
  const conversation = page.getByTestId(`conversation-${source.id}`)
  await expect(conversation).toBeVisible()
  // 방금 들어온 항목 표시 + 도우미 말풍선
  await expect(conversation).toHaveAttribute('data-fresh', 'true')
  await expect(shared.locator('[data-fresh="true"]')).toHaveCount(3)
  await expect(page.getByTestId('assistant-bubble')).toContainText('같은 태그 대화 1개·파일 3개')
  await expect(page.getByTestId('assistant-bubble')).toContainText('들어왔')

  // [첨부] 한 번 — 범위 고르기 창 없이 대화 전체가 입력창 칩으로
  await page.getByTestId('conversation-candidates').getByRole('button', { name: `${source.code} 첨부`, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const chips = page.getByRole('list', { name: '첨부', exact: true })
  await expect(chips.getByRole('listitem').filter({ hasText: source.code })).toHaveAttribute('title', /전체 원문/)
  const inputs = await (await page.request.get(`/api/tasks/${consumer.id}/conversation-inputs`)).json() as Array<{ snapshot: { mode: string; messageIds: string[] } }>
  expect(inputs).toHaveLength(1)
  expect(inputs[0]!.snapshot).toMatchObject({ mode: 'full', messageIds: [expect.any(String), expect.any(String)] })

  const question = `소비 질문 ${marker}`
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(question)
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect.poll(async () => (await messages(page, consumer.threadId)).at(-1)?.status, { timeout: 30_000 }).toBe('done')
  // 실제로 보낸 요청 원본(스냅샷)에 A 대화의 질문·답이 모두 있다
  const requestId = (await messages(page, consumer.threadId)).at(-1)!.requestId!
  const sent = JSON.stringify(await (await page.request.get(`/api/requests/${requestId}/snapshot`)).json())
  expect(sent).toContain(`원본 질문 ${marker}`)
  expect(sent).toContain(JSON.stringify(sourceReply.slice(0, 40)).slice(1, -1))
  if (live) {
    // 가짜 OpenWebUI가 받은 본문에도 A 대화 전체가 실렸다
    let body = ''
    await expect.poll(async () => {
      const requests = await (await page.request.get(`http://127.0.0.1:${process.env.E2E_FAKE_OWUI_PORT ?? '3102'}/__e2e/requests`)).json() as Array<{ messages: unknown[] }>
      body = JSON.stringify(requests.findLast((entry) => JSON.stringify(entry.messages).includes(question) && !JSON.stringify(entry.messages[0] ?? '').includes('다음 대화의 제목'))?.messages ?? [])
      return body.includes(question)
    }).toBe(true)
    expect(body).toContain(`원본 질문 ${marker}`)
    expect(body).toContain(JSON.stringify(sourceReply.slice(0, 40)).slice(1, -1))
  }
})

test('태그를 빼면 빠진 대화·파일을 표시하고 도우미가 알린다', async ({ page }) => {
  await signup(page, 'out')
  const marker = `DO${Date.now().toString(36)}`
  const tag = `share-${marker}`
  const source = await sourceConversation(page, tag, marker)
  const consumer = await createTask(page, [tag])
  await page.route('**/api/events', (route) => route.abort())
  await openMaterials(page, consumer.id)
  const shared = page.getByTestId('materials-shared')
  await expect(shared).toContainText(`upload-${marker}.txt`)
  await expect(page.getByTestId(`conversation-${source.id}`)).toBeVisible()
  // 처음 열 때는 '방금 들어옴'이 아니다
  await expect(page.locator('[data-fresh="true"]')).toHaveCount(0)

  await page.getByRole('button', { name: `${tag} 태그 제거` }).click()
  await expect(shared).not.toContainText(`upload-${marker}.txt`)
  await expect(page.getByTestId(`conversation-${source.id}`)).toHaveCount(0)
  const gone = page.getByTestId('materials-gone')
  await expect(gone).toContainText(source.code)
  await expect(gone).toContainText(`upload-${marker}.txt`)
  await expect(page.getByTestId('assistant-bubble')).toContainText('같은 태그 대화 1개·파일 3개')
  await expect(page.getByTestId('assistant-bubble')).toContainText('빠졌')
})
