import { materialToggleName, revealMaterials } from './materials.js'
import { expect, test, type Page } from '@playwright/test'

// S11 U2 같은 태그 펼침 패널·담기 — 시드에 기대지 않고 테스트마다 사용자·대화·태그를 직접 만든다
const password = 'e2e-password-1234'
async function signup(page: Page, suffix: string) {
  const id = `cmp-${suffix}-${Date.now()}`.slice(0, 32)
  await page.goto('/signup')
  await page.getByLabel('ID').fill(id)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill(id)
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
  return (await response.json()) as { id: string; code: string; threadId: string }
}
async function answered(page: Page, threadId: string, content: string) {
  const result = await page.request.post(`/api/threads/${threadId}/requests`, { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { content } })
  expect(result.status()).toBe(201)
  await expect.poll(async () => (await (await page.request.get(`/api/threads/${threadId}/messages`)).json() as Array<{ status: string }>).at(-1)?.status).toBe('done')
}
const panel = (page: Page) => page.getByTestId('conversation-candidates')

test('indirect tag not listed — 다른 태그로만 이어진 대화는 패널에 없고, 직접 공유 대화도 기본 무체크다', async ({ page }) => {
  await signup(page, 'ind')
  const stamp = Date.now().toString(36)
  const me = await createTask(page, [`cmp-x-${stamp}`])
  const bridge = await createTask(page, [`cmp-x-${stamp}`, `cmp-y-${stamp}`])
  const indirect = await createTask(page, [`cmp-y-${stamp}`])
  await page.goto(`/c/${me.id}`)
  await revealMaterials(page) // 자동 펼침 없음(S16 상시 레일) — 후보는 레일의 자료 탭에서 본다
  await expect(panel(page).getByRole('button', { name: new RegExp(bridge.code + ' ·') })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: new RegExp(indirect.code + ' ·') })).toHaveCount(0)
  const box = panel(page).getByRole('button', { name: materialToggleName(`${bridge.code}`), exact: true })
  await expect(box).toBeDisabled() // 메시지가 없는 대화는 보내지 않는다.
  await expect(box).toHaveAttribute('aria-pressed', 'false')
  await expect(panel(page).locator('[aria-pressed]')).toHaveCount(1)

})

test('estimate equals send after add — 패널에서 대화 본문·파일을 첨부한 뒤 입력창 칩·추정과 실제 전송 크기가 같다', async ({ page }) => {
  test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) === 'live', 'Mock 전용 기록 검사')
  await signup(page, 'est')
  const tag = `cmp-est-${Date.now().toString(36)}`
  const source = await createTask(page, [tag])
  const consumer = await createTask(page, [tag])
  await answered(page, source.threadId, '담기 원본 질문 U2')
  const fileName = `compose-${Date.now()}.txt`
  const upload = await page.request.post('/api/files', { multipart: { originTaskId: source.id, file: { name: fileName, mimeType: 'text/plain', buffer: Buffer.from('담기 자료 본문 U2') } } })
  expect(upload.ok()).toBe(true)

  await page.goto(`/c/${consumer.id}`)
  await revealMaterials(page) // 자동 펼침 없음(S16 상시 레일) — 후보는 레일의 자료 탭에서 본다
  const attachConversation = panel(page).getByRole('button', { name: materialToggleName(`${source.code}`), exact: true })
  await attachConversation.click()
  await page.getByTestId('materials-shared').getByRole('button', { name: materialToggleName(`${fileName}`), exact: true }).click()
  await expect(attachConversation).toHaveAttribute('aria-pressed', 'true')
  await expect(attachConversation).toHaveText('첨부됨 ✓')

  const draft = '담은 자료로 답해 줘 U2'
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(draft)
  const chips = page.getByRole('list', { name: '첨부', exact: true }).getByRole('listitem')
  await expect(chips).toHaveCount(2)
  const estimate = await (await page.request.post(`/api/threads/${consumer.threadId}/requests/estimate`, { data: { draft } })).json() as { bytes: number; inputs: Array<{ kind: string; name?: string; code?: string }> }
  // 입력창 칩이 같은 조립 함수의 추정(보낼 것)과 같다
  await expect(chips).toHaveText(estimate.inputs.map((input) => (input.kind === 'file' ? input.name : input.code)!))
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(async () => {
    const messages = await (await page.request.get(`/api/threads/${consumer.threadId}/messages`)).json() as Array<{ role: string; requestId?: string }>
    const reply = messages.findLast((item) => item.role === 'assistant' && !!item.requestId)
    expect(reply).toBeDefined()
    const record = await (await page.request.get(`/api/requests/${reply!.requestId}`)).json() as { bytes: number; status: string }
    expect(record.status).toBe('succeeded')
    expect(record.bytes).toBe(estimate.bytes)
  }).toPass()
})

test('일괄 담기 대체 경로 — 여러 자료를 고를 때 부분 실패한 파일만 재시도하고 기존 선택을 보존한다', async ({ page }) => {
  await signup(page, 'partial')
  const tag = `cmp-partial-${Date.now().toString(36)}`
  const source = await createTask(page, [tag])
  const consumer = await createTask(page, [tag])
  await answered(page, source.threadId, '부분 실패 시 보존할 대화')
  const upload = await page.request.post('/api/files', { multipart: { originTaskId: source.id, file: { name: 'retry.txt', mimeType: 'text/plain', buffer: Buffer.from('재시도할 파일') } } })
  expect(upload.ok()).toBe(true)
  const file = await upload.json() as { id: string }
  let attempts = 0
  await page.route(`**/api/tasks/${consumer.id}/inputs/${file.id}`, async route => {
    if (route.request().method() === 'PUT' && ++attempts === 1) await route.fulfill({ status: 503, json: { message: '파일 담기 일시 실패' } })
    else await route.continue()
  })
  await page.goto(`/c/${consumer.id}`)
  await revealMaterials(page) // 자동 펼침 없음(S16 상시 레일) — 후보는 레일의 자료 탭에서 본다
  const conversation = panel(page).getByRole('button', { name: materialToggleName(source.code) })
  const fileToggle = page.getByTestId(`candidate-file-${file.id}`).getByRole('button', { name: materialToggleName('retry.txt') })
  await conversation.click()
  await expect(conversation).toHaveAttribute('aria-pressed', 'true')
  await fileToggle.click()
  await expect(page.getByText('파일 담기 일시 실패', { exact: true })).toBeVisible()
  await expect(fileToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(conversation).toHaveAttribute('aria-pressed', 'true')
  const chips = page.getByRole('list', { name: '첨부', exact: true }).getByRole('listitem')
  await expect(chips).toHaveCount(1)
  await fileToggle.click()
  await expect(fileToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(chips).toHaveCount(2)
  expect(attempts).toBe(2)
  const selected = await (await page.request.get(`/api/tasks/${consumer.id}/conversation-inputs`)).json() as unknown[]
  expect(selected).toHaveLength(1)
})

test('버전 선택 대체 경로 — 연결 자료에서 이전 버전을 직접 담고 최신 버전으로 명시 전환한다', async ({ page }) => {
  await signup(page, 'version')
  const tag = `cmp-version-${Date.now().toString(36)}`
  const source = await createTask(page, [tag])
  const consumer = await createTask(page, [tag])
  const versions: Array<{ id: string }> = []
  for (const content of ['첫 버전', '두 번째 버전']) {
    const response = await page.request.post('/api/files', { multipart: { originTaskId: source.id, file: { name: 'version.txt', mimeType: 'text/plain', buffer: Buffer.from(content) } } })
    expect(response.ok()).toBe(true)
    versions.push(await response.json() as { id: string })
  }
  await page.goto(`/c/${consumer.id}`)
  await revealMaterials(page) // 자동 펼침 없음(S16 상시 레일) — 후보는 레일의 자료 탭에서 본다
  const latest = page.getByTestId(`candidate-file-${versions[1]!.id}`)
  await latest.getByRole('button', { name: '이전 버전 1', exact: true }).click()
  await latest.getByRole('button', { name: materialToggleName('version.txt v1') }).click()
  const chips = page.getByRole('list', { name: '첨부', exact: true }).getByRole('listitem')
  await expect(chips).toHaveCount(1)
  await expect(chips).toHaveAttribute('title', /version\.txt v1/)
  // v2가 있어도 v1을 그대로 보낸다 — 사용자가 바꾸기를 누를 때만 대체한다.
  const task = await (await page.request.get(`/api/tasks/${consumer.id}`)).json() as { inputs: Array<{ fileId: string }> }
  expect(task.inputs.map(input => input.fileId)).toEqual([versions[0]!.id])
  await page.getByTestId(`candidate-file-${versions[0]!.id}`).getByRole('button', { name: '새 버전 있음 · 바꾸기' }).click()
  await expect(chips).toHaveCount(1)
  await expect(chips).toHaveAttribute('title', /version\.txt v2/)
})
