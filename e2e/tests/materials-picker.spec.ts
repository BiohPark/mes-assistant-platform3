import { expect, test, type Page } from '@playwright/test'
import { linkedMaterialsToggle, materialToggleName, revealMaterials } from './materials.js'

const password = 'e2e-password-1234'
type Conversation = { id: string; threadId: string; code: string }
async function setup(page: Page) {
  const signup = await page.request.post('/api/auth/signup', { data: { loginId: `picker-${Date.now()}`.slice(0, 32), name: '자료 선택 담당자', password } })
  expect(signup.ok()).toBe(true)
  const user = await signup.json() as { id: string }
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
  const assistantId = assistants.find(item => item.status === 'open')!.id
  const create = async (tags: string[] = []) => {
    const response = await page.request.post('/api/tasks', { data: { assistantId, tags } })
    expect(response.ok()).toBe(true)
    const task = await response.json() as Conversation
    // Other specs edit the global default model. Keep this scenario's assembly independent.
    expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { modelId: 'fake-general' } })).ok()).toBe(true)
    return task
  }
  return { create, user }
}
async function answered(page: Page, threadId: string, content: string) {
  const response = await page.request.post(`/api/threads/${threadId}/requests`, { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { content } })
  expect(response.status()).toBe(201)
  await expect.poll(async () => (await (await page.request.get(`/api/threads/${threadId}/messages`)).json() as Array<{ status: string }>).at(-1)?.status).toBe('done')
}
async function upload(page: Page, taskId: string, name = 'manual.txt') {
  const response = await page.request.post('/api/files', { multipart: { originTaskId: taskId, file: { name, mimeType: 'text/plain', buffer: Buffer.from('원문 104.25 mm') } } })
  expect(response.ok()).toBe(true)
  return await response.json() as { id: string }
}
const picker = (page: Page) => page.getByRole('dialog', { name: '이번 질문에 보낼 자료 고르기' })
async function openPicker(page: Page) {
  await page.locator('[data-tour="materials-picker"]').click()
  await expect(picker(page)).toBeVisible()
}
async function send(page: Page, text: string, threadId: string) {
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(text)
  await expect(page.getByRole('button', { name: '전송', exact: true })).toBeEnabled()
  const accepted = page.waitForResponse(response => response.url().endsWith(`/threads/${threadId}/requests`) && response.request().method() === 'POST')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  expect((await accepted).status()).toBe(201)
  await expect.poll(async () => (await (await page.request.get(`/api/threads/${threadId}/messages`)).json() as Array<{ status: string }>).at(-1)?.status).toBe('done')
  await expect(page.getByRole('button', { name: '중지', exact: true })).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('')
}

test('같은 태그 대화 2개의 후보 수는 접힌 헤더·선택기에서 일치하고 갱신된다', async ({ page }) => {
  const { create } = await setup(page)
  const tag = `count-${crypto.randomUUID()}`
  const task = await create([tag])
  await create([tag])
  await create([tag])
  await answered(page, task.threadId, '패널 자동 열림 없이 후보 확인')
  await page.goto(`/c/${task.id}`)
  const header = linkedMaterialsToggle(page)
  const attach = page.locator('[data-tour="materials-picker"]')
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(header).toHaveText('연결 자료(2)')
  await expect(attach).toHaveText('+ 첨부 · 후보 2')
  await revealMaterials(page)
  await expect(header).toHaveText('연결 자료(2)')
  await header.click()
  await create([tag])
  await expect(header).toHaveText('연결 자료(3)')
  await expect(attach).toHaveText('+ 첨부 · 후보 3')
})

test('1A·2B: 첫 질문은 무첨부, SR 본문만 선택하고 추정과 전송이 일치한다', async ({ page }) => {
  const { create } = await setup(page)
  const draft = await (await page.request.post('/api/service-requests')).json() as { id: string }
  const file = await (await page.request.post(`/api/service-requests/${draft.id}/files`, { multipart: { file: { name: 'large-log.txt', mimeType: 'text/plain', buffer: Buffer.from('SR attachment') } } })).json() as { id: string }
  const sr = await (await page.request.post(`/api/service-requests/${draft.id}/submit`, { data: { title: 'SR 본문만 확인', body: '측정값 104.25 mm', attachmentIds: [file.id] } })).json() as { id: string; code: string }
  const task = await create([sr.code])
  const count = await page.request.get(`/api/tasks/${task.id}/candidate-count`)
  expect(count.status()).toBe(200)
  expect(await count.json()).toEqual({ count: 2 })
  await page.goto(`/c/${task.id}`)
  await expect(linkedMaterialsToggle(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('[data-tour="materials-picker"]')).toHaveText('+ 첨부 · 후보 2')
  await expect(page.getByText('이번 질문에 보낼 자료 · 0개')).toBeVisible()
  await send(page, '첨부 없는 일반 질문', task.threadId)
  await expect(linkedMaterialsToggle(page)).toHaveAttribute('aria-expanded', 'false')
  const firstMessages = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Array<{ requestId?: string }>
  const firstId = firstMessages.findLast(item => item.requestId)?.requestId
  const first = await (await page.request.get(`/api/requests/${firstId}`)).json() as { inputs: unknown[] }
  expect(first.inputs).toEqual([])
  await openPicker(page)
  await expect(picker(page).getByTestId('materials-sr-bodies')).toContainText('연결 SR 본문')
  await expect(picker(page).getByTestId('materials-sr-files')).toContainText('연결 SR 첨부파일')
  await picker(page).getByRole('button', { name: materialToggleName(sr.code) }).click()
  await expect(picker(page).getByRole('button', { name: `첨부됨 ✓ · ${sr.code}` })).toHaveAttribute('aria-pressed', 'true')
  await expect(picker(page).getByRole('button', { name: `+ 첨부 · large-log.txt` })).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Escape')
  await revealMaterials(page)
  await expect(page.getByTestId(`sr-body-${sr.id}`).getByRole('button', { name: `첨부됨 ✓ · ${sr.code}` })).toHaveAttribute('aria-pressed', 'true')
  const content = 'SR 본문만 확인해줘'
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(content)
  const estimate = await (await page.request.post(`/api/threads/${task.threadId}/requests/estimate`, { data: { draft: content } })).json() as { bytes: number; inputs: Array<{ kind: string }> }
  expect(estimate.inputs.map(item => item.kind)).toEqual(['sr'])
  const finalEstimate = page.waitForResponse(response => response.url().endsWith(`/threads/${task.threadId}/requests/estimate`) && response.request().postDataJSON().draft === content && Array.isArray(response.request().postDataJSON().attachmentIds))
  const completed = page.waitForResponse(response => response.url().endsWith(`/threads/${task.threadId}/requests`) && response.request().method() === 'POST')
  await send(page, content, task.threadId)
  const preview = await (await finalEstimate).json() as { bytes: number; inputSignature: string }
  expect((await completed).request().postDataJSON().inputSignature).toBe(preview.inputSignature)
  const latestMessages = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Array<{ requestId?: string }>
  const latestId = latestMessages.findLast(item => item.requestId)?.requestId
  const actual = await (await page.request.get(`/api/requests/${latestId}`)).json() as { bytes: number; inputs: Array<{ kind: string }> }
  expect(actual.bytes).toBe(preview.bytes)
  expect(actual.inputs.map(item => item.kind)).toEqual(['sr'])
})

test('선택 저장·최신 추정 중 전송 잠금, 패널↔선택기 동기화와 사용됨 독립 표시', async ({ page }) => {
  const { create } = await setup(page)
  const sharedTag = `picker-lock-${crypto.randomUUID()}`
  const task = await create([sharedTag])
  const source = await create([sharedTag])
  const sharedFile = await upload(page, source.id)
  const file = await upload(page, task.id)
  await page.request.put(`/api/tasks/${task.id}/inputs/${file.id}`, { data: { weight: 'reference' } })
  await answered(page, task.threadId, '이력 만들기')
  await page.goto(`/c/${task.id}`)
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill('저장 중 질문')
  await openPicker(page)
  let release!: () => void
  const saving = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/tasks/${task.id}/inputs/${file.id}`, async route => {
    if (route.request().method() === 'PUT') await saving
    await route.continue()
  })
  // Equal names from different conversations are distinct materials; identify the file, not its name globally.
  const row = picker(page).getByTestId(`file-${file.id}`)
  await expect(picker(page).getByRole('button', { name: materialToggleName('manual.txt') })).toHaveCount(2)
  await expect(picker(page).getByTestId(`candidate-file-${sharedFile.id}`)).toBeVisible()
  await row.getByRole('button', { name: materialToggleName('manual.txt') }).click()
  await expect(row.getByRole('button', { name: materialToggleName('manual.txt') })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '전송', exact: true })).toBeDisabled()
  await expect(page.getByText('자료 선택 저장 중…')).toBeVisible()
  release()
  await expect(page.getByRole('button', { name: '전송', exact: true })).toBeEnabled()
  await revealMaterials(page)
  await expect(page.getByTestId(`file-${file.id}`).getByRole('button', { name: '첨부됨 ✓ · manual.txt', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId(`used-${file.id}`)).toHaveAttribute('title', '이전 요청에 포함된 자료입니다. 원문을 다시 확인하려면 첨부하세요.')
  await page.getByTestId(`file-${file.id}`).getByRole('button', { name: '첨부됨 ✓ · manual.txt', exact: true }).click()
  await openPicker(page)
  await expect(picker(page).getByTestId(`file-${file.id}`).getByRole('button', { name: '+ 첨부 · manual.txt', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

test('직전 자료는 클릭할 때만 복원되고 범위·버전·D67을 유지한다', async ({ page }) => {
  const { create } = await setup(page)
  const source = await create(['picker-repeat'])
  const task = await create(['picker-repeat'])
  await answered(page, source.threadId, '원문 1')
  const messages = await (await page.request.get(`/api/threads/${source.threadId}/messages`)).json() as Array<{ id: string }>
  const file = await upload(page, source.id, 'versioned.txt')
  const chosen = await (await page.request.put(`/api/tasks/${task.id}/conversation-inputs/${source.id}`, { data: { mode: 'messages', messageIds: [messages[0]!.id], weight: 'main' } })).json() as { snapshot: { id: string } }
  await page.request.put(`/api/tasks/${task.id}/inputs/${file.id}`, { data: { weight: 'reference' } })
  await answered(page, task.threadId, '첫 질문')
  await upload(page, source.id, 'versioned.txt')
  await answered(page, source.threadId, '나중 메시지 제외')
  await page.goto(`/c/${task.id}`)
  const restore = page.getByRole('button', { name: '↺ 직전 질문 자료 다시 첨부 (2개)', exact: true })
  await expect(restore).toBeVisible()
  await expect(page.getByTestId('composer-attachments')).toHaveCount(0)
  await openPicker(page)
  await expect(picker(page).getByRole('button', { name: '↺ 직전 질문 자료 다시 첨부 (2개)', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await restore.click()
  await expect(page.getByText('이번 질문에 보낼 자료 · 2개')).toBeVisible()
  const selections = await (await page.request.get(`/api/tasks/${task.id}/conversation-inputs`)).json() as Array<{ snapshot: { id: string; messageIds: string[] } }>
  expect(selections[0]!.snapshot).toMatchObject({ id: chosen.snapshot.id, messageIds: [messages[0]!.id] })
  const question = `다시 원문 대조 ${task.id}`
  await send(page, question, task.threadId)
  if ((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) === 'live') {
    const calls = await (await page.request.get(`http://127.0.0.1:${process.env.E2E_FAKE_OWUI_PORT ?? '3102'}/__e2e/requests`)).json() as Array<{ messages: Array<{ content: string }> }>
    const prompt = calls.findLast(call => call.messages.some(message => message.content.includes(question)))?.messages.map(message => message.content).join('\n')
    expect(prompt).toContain('원문 1')
    expect(prompt).not.toContain('나중 메시지 제외')
  }
  await expect(page.getByTestId('composer-attachments')).toHaveCount(0)
  expect(await (await page.request.get(`/api/tasks/${task.id}/conversation-inputs`)).json()).toEqual([])
})

test('삭제 자료는 재첨부 후보에서 제외한다', async ({ page }) => {
  const { create } = await setup(page)
  const task = await create()
  const file = await upload(page, task.id)
  await page.request.put(`/api/tasks/${task.id}/inputs/${file.id}`, { data: { weight: 'reference' } })
  await answered(page, task.threadId, '삭제 전 질문')
  expect((await page.request.delete(`/api/files/${file.id}`)).status()).toBe(204)
  expect(await (await page.request.get(`/api/tasks/${task.id}/conversation-inputs/previous-materials`)).json()).toEqual([])
  await page.goto(`/c/${task.id}`)
  await expect(page.getByRole('button', { name: /^↺ 직전 질문 자료 다시 첨부/ })).toHaveCount(0)
})

test('현재 권한을 잃은 자료는 재첨부 후보에서 제외한다', async ({ page, browser }) => {
  const { create, user } = await setup(page)
  const task = await create(['picker-access'])
  const owner = await browser.newContext({ baseURL: process.env.APP_ORIGIN ?? 'http://localhost:5173' })
  try {
    expect((await owner.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
    const assistants = await (await owner.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
    const source = await (await owner.request.post('/api/tasks', { data: { assistantId: assistants.find(item => item.status === 'open')!.id, tags: ['picker-access'] } })).json() as Conversation
    await answered(page, source.threadId, '접근 가능한 동안 고른 자료')
    await page.request.put(`/api/tasks/${task.id}/conversation-inputs/${source.id}`, { data: { mode: 'full' } })
    await answered(page, task.threadId, '권한 변경 전 질문')
    expect((await owner.request.put(`/api/users/${user.id}/business-owner`, { data: { enabled: true } })).status()).toBe(204)
    expect(await (await page.request.get(`/api/tasks/${task.id}/conversation-inputs/previous-materials`)).json()).toEqual([])
  } finally { await owner.close() }
})

test('태그 추가는 수동 닫힘을 유지하고 다른 참여자의 선택을 추정·선택기에 반영한다', async ({ page }) => {
  const { create } = await setup(page)
  const task = await create(['picker-tags'])
  const file = await upload(page, task.id)
  await page.goto(`/c/${task.id}`)
  await expect(linkedMaterialsToggle(page)).toHaveAttribute('aria-expanded', 'true')
  await linkedMaterialsToggle(page).click()
  await page.request.put(`/api/tasks/${task.id}/tags/picker-new-tag`)
  await expect(linkedMaterialsToggle(page)).toHaveAttribute('aria-expanded', 'false')
  // An external request follows the same event path as another participant's selection.
  await page.request.put(`/api/tasks/${task.id}/inputs/${file.id}`, { data: { weight: 'reference' } })
  await expect(page.getByTestId('composer-attachments')).toContainText('manual.txt')
  await openPicker(page)
  await expect(picker(page).getByTestId(`file-${file.id}`).getByRole('button', { name: '첨부됨 ✓ · manual.txt', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await picker(page).getByRole('textbox', { name: '자료 검색' }).fill('없는 자료')
  await expect(picker(page).getByRole('button', { name: /manual.txt/ })).toHaveCount(0)
})


test('빈 트레이에서 첨부한 뒤 Escape는 상시 첨부 버튼으로 포커스를 돌린다', async ({ page }) => {
  const { create } = await setup(page)
  const task = await create()
  const file = await upload(page, task.id)
  const count = await page.request.get(`/api/tasks/${task.id}/candidate-count`)
  expect(count.status()).toBe(200)
  expect(await count.json()).toEqual({ count: 1 })
  await page.goto(`/c/${task.id}`)
  await page.getByRole('button', { name: /이번 질문에 보낼 자료를 \[\+ 첨부\]에서 고르세요/ }).click()
  await picker(page).getByTestId(`file-${file.id}`).getByRole('button', { name: '+ 첨부 · manual.txt', exact: true }).click()
  await expect(page.getByText('이번 질문에 보낼 자료 · 1개')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-tour="materials-picker"]')).toBeFocused()
})

test('완료 대화도 선택기에서 로컬 파일을 준비하고 전송 때 재개를 확인한다', async ({ page }) => {
  const { create } = await setup(page)
  const task = await create()
  expect((await page.request.post(`/api/tasks/${task.id}/status`, { data: { status: 'done', reason: '선택기 완료 시나리오' } })).ok()).toBe(true)
  await page.goto(`/c/${task.id}`)
  await openPicker(page)
  const local = picker(page).getByRole('button', { name: '내 PC 파일 올리기' })
  await expect(local).toBeEnabled()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), local.click()])
  await chooser.setFiles({ name: 'completed-local.txt', mimeType: 'text/plain', buffer: Buffer.from('complete original') })
  await expect(picker(page)).toBeHidden()
  await expect(page.getByTestId('composer-attachments')).toContainText('completed-local.txt')
  await expect(page.getByRole('button', { name: '전송', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('재개')
})

test('영어 선택기는 검색 결과·첨부·해제를 같은 상태로 표시한다', async ({ page }) => {
  const { create } = await setup(page)
  const task = await create()
  await upload(page, task.id)
  expect((await page.request.patch('/api/me', { data: { locale: 'en' } })).ok()).toBe(true)
  await page.goto(`/c/${task.id}`)
  await page.locator('[data-tour="materials-picker"]').click()
  const dialog = page.getByRole('dialog', { name: 'Choose materials for this question' })
  await expect(dialog.getByRole('button', { name: 'Upload from computer' })).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Search materials' }).fill('manual')
  await dialog.getByRole('button', { name: '+ Attach · manual.txt', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Attached ✓ · manual.txt', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByText('Materials for this question · 1')).toBeVisible()
  await page.getByRole('button', { name: 'Remove manual.txt attachment', exact: true }).click()
  await expect(page.getByText('Materials for this question · 0')).toBeVisible()
})


test('추정 뒤 다른 참여자의 첨부 변경은 409로 막고 재추정 후 같은 자료를 전송한다', async ({ page, browser }) => {
  const { create } = await setup(page)
  const task = await create()
  const file = await upload(page, task.id, 'race.txt')
  const other = await browser.newContext({ baseURL: process.env.APP_ORIGIN ?? 'http://localhost:5173' })
  try {
    expect((await other.request.post('/api/auth/signup', { data: { loginId: `race-${crypto.randomUUID()}`.slice(0, 32), name: '다른 참여자', password } })).ok()).toBe(true)
    await page.goto(`/c/${task.id}`)
    await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill('변경된 첨부 확인')
    await expect(page.getByRole('button', { name: '전송', exact: true })).toBeEnabled()
    let changed = false
    await page.route(`**/api/threads/${task.threadId}/requests`, async route => {
      if (!changed) {
        changed = true
        expect(route.request().postDataJSON().inputSignature).toMatch(/^[a-f0-9]{64}$/)
        expect((await other.request.put(`/api/tasks/${task.id}/inputs/${file.id}`, { data: { weight: 'reference' } })).ok()).toBe(true)
      }
      await route.continue()
    })
    const rejected = page.waitForResponse(response => response.url().endsWith(`/threads/${task.threadId}/requests`) && response.status() === 409)
    await page.getByRole('button', { name: '전송', exact: true }).click()
    expect(await (await rejected).json()).toMatchObject({ code: 'INPUT_SELECTION_CHANGED' })
    const conflict = page.getByRole('listitem').filter({ hasText: '첨부 자료가 변경되었습니다. 자료 용량을 다시 확인한 뒤 전송하세요.' })
    await expect(conflict).toBeVisible()
    // The bottom-right toast covers Send; hovering it pauses Sonner's auto-dismiss timer.
    await conflict.getByRole('button', { name: 'Close toast', exact: true }).click()
    await expect(conflict).toBeHidden()
    await expect(page.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('변경된 첨부 확인')
    expect(await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json()).toEqual([])
    const selection = await (await page.request.get(`/api/tasks/${task.id}`)).json() as { inputs: Array<{ fileId: string }> }
    expect(selection.inputs.map(item => item.fileId)).toEqual([file.id])
    const previews = new Map<string, number>()
    page.on('response', async response => {
      if (response.url().endsWith(`/threads/${task.threadId}/requests/estimate`) && response.ok()) {
        const body = await response.json() as { inputSignature: string; bytes: number }
        previews.set(body.inputSignature, body.bytes)
      }
    })
    const accepted = page.waitForResponse(response => response.url().endsWith(`/threads/${task.threadId}/requests`) && response.status() === 201)
    await send(page, '변경된 첨부 확인', task.threadId)
    const post = await accepted
    const signature = post.request().postDataJSON().inputSignature as string
    const messages = await (await page.request.get(`/api/threads/${task.threadId}/messages`)).json() as Array<{ requestId?: string }>
    const actual = await (await page.request.get(`/api/requests/${messages.findLast(item => item.requestId)?.requestId}`)).json() as { bytes: number; inputs: Array<{ fileId: string }> }
    expect(actual.inputs.map(item => item.fileId)).toEqual([file.id])
    expect(previews.get(signature)).toBe(actual.bytes)
  } finally { await other.close() }
})
