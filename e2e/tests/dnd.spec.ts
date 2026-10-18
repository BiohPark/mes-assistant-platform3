import { revealMaterials } from './materials.js'
import { expect, test, type JSHandle, type Locator, type Page } from '@playwright/test'

const password = 'e2e-password-1234'

async function signUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-dnd-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}

/** 탐색기에서 끌어온 것과 같은 DataTransfer를 페이지 안에서 만든다 — 업로드 자체는 기존 multipart 경로다 */
function dataTransfer(page: Page, files: Array<{ name: string; content: string }>): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle((files) => {
    const data = new DataTransfer()
    for (const file of files) data.items.add(new File([file.content], file.name, { type: 'text/plain' }))
    return data
  }, files)
}

async function drop(zone: Locator, data: JSHandle<DataTransfer>) {
  await zone.dispatchEvent('dragenter', { dataTransfer: data })
  await zone.dispatchEvent('dragover', { dataTransfer: data })
  await zone.dispatchEvent('drop', { dataTransfer: data })
}

test('SR 접수에 끌어 놓은 파일은 전송 후에도 SR 첨부로 남는다', async ({ page }) => {
  await signUp(page)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; name: string; status: string }>
  const assistant = assistants.find(item => item.status === 'open')!
  expect(assistant).toBeTruthy()
  // 전역 접수 설정을 바꾸지 않고 UI 설정만 고정한다. 생성·파일 업로드·메시지 저장은 실제 API를 쓴다.
  await page.route('**/api/service-requests/intake-assistant', route => route.fulfill({ json: { srIntakeAssistantId: assistant.id, name: assistant.name } }))
  await page.route('**/api/threads/*/requests', async route => {
    const threadId = new URL(route.request().url()).pathname.split('/')[3]!
    const body = route.request().postDataJSON() as { content: string; attachmentIds: string[] }
    expect(body.attachmentIds).toHaveLength(1)
    const saved = await page.request.post(`/api/threads/${threadId}/messages`, { data: { content: body.content, attachmentIds: body.attachmentIds, kind: 'discussion' } })
    expect(saved.ok()).toBe(true)
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: started\ndata: {"requestId":"e2e-sr-dnd","replyMessageId":"e2e-sr-dnd-reply"}\n\nevent: completed\ndata: {}\n\n' })
  })
  await page.goto('/sr')
  await page.getByRole('button', { name: '새 요청' }).click()
  await expect(page.getByText('📎나 끌어 놓기로 파일을 첨부할 수 있어요.')).toBeVisible()
  const zone = page.getByTestId('sr-dropzone')
  const data = await dataTransfer(page, [{ name: 'sr-dnd.txt', content: '현장 알람 첨부' }])
  await zone.dispatchEvent('dragenter', { dataTransfer: data })
  await expect(page.getByText('놓으면 첨부 대기에 추가')).toBeVisible()
  await drop(zone, data)
  await expect(page.getByText('sr-dnd.txt', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /첨부 (제거|취소)$/ })).toHaveCount(1)
  await page.getByRole('textbox', { name: '접수 메시지' }).fill('드롭 첨부 요청')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('id')).toBeTruthy()
  const srId = new URL(page.url()).searchParams.get('id')!
  await expect(page.getByRole('region', { name: '접수 대화' })).toContainText('드롭 첨부 요청')
  const detail = await (await page.request.get(`/api/service-requests/${srId}`)).json() as { threadId: string; candidateAttachmentIds: string[] }
  expect(detail.candidateAttachmentIds).toHaveLength(1)
  const fileId = detail.candidateAttachmentIds[0]!
  const messages = await (await page.request.get(`/api/threads/${detail.threadId}/messages`)).json() as Array<{ content: string; attachmentIds: string[] }>
  expect(messages).toContainEqual(expect.objectContaining({ content: '드롭 첨부 요청', attachmentIds: [fileId] }))
  const content = await page.request.get(`/api/files/${fileId}/content`)
  expect(content.ok()).toBe(true)
  expect(await content.text()).toBe('현장 알람 첨부')
  await page.reload()
  await expect(page.getByRole('region', { name: '접수 대화' })).toContainText('sr-dnd.txt')
})

test('초안 화면에 끌어다 놓으면 첨부 대기 칩이 되고 첫 전송에서 입력으로 고정된다', async ({ page }) => {
  await signUp(page)
  await page.getByRole('link', { name: /새 대화/ }).first().click()
  await expect(page).toHaveURL(/\/new\//)
  const zone = page.getByTestId('draft-dropzone')
  const data = await dataTransfer(page, [{ name: 'dnd-one.txt', content: 'one' }, { name: 'dnd-two.txt', content: 'two' }])
  await zone.dispatchEvent('dragenter', { dataTransfer: data })
  await expect(page.getByText('놓으면 첨부 대기에 추가')).toBeVisible()
  await zone.dispatchEvent('dragleave', { dataTransfer: data })
  await expect(page.getByText('놓으면 첨부 대기에 추가')).toBeHidden()
  await drop(zone, data)
  await expect(page.getByText('2개 파일을 첨부 대기에 추가했습니다.')).toBeVisible()
  await expect(page.getByText('dnd-one.txt')).toBeVisible()
  await expect(page.getByText('dnd-two.txt')).toBeVisible()
  await expect(page.getByRole('button', { name: /첨부 (제거|취소)$/ })).toHaveCount(2)
  await expect(page.getByRole('button', { name: /입력으로 고정|이번 메시지만/ })).toHaveCount(0)
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page).toHaveURL(/\/c\/[^/]+$/)
  await revealMaterials(page)
  // 첨부는 자료함에 남고 첫 요청에만 갔다(D54 개정) — '사용됨', 입력창 첨부 칩은 비었다
  await expect(page.getByTestId('materials-own')).toContainText('dnd-one.txt')
  await expect(page.getByTestId('materials-own')).toContainText('dnd-two.txt')
  await expect(page.getByTestId('materials-own').getByText('사용됨')).toHaveCount(2)
  await expect(page.getByRole('list', { name: '첨부', exact: true })).toHaveCount(0)
})

test('대화 화면: 자료 패널에 놓으면 저장, 팀 의견 첨부는 AI 첨부에서 제외, 빈 파일은 거부', async ({ page }) => {
  await signUp(page)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string }
  await page.goto(`/c/${task.id}`)
  await revealMaterials(page)
  const own = page.getByTestId('materials-own')
  await own.dispatchEvent('dragenter', { dataTransfer: await dataTransfer(page, [{ name: 'dnd-own.txt', content: 'own' }]) })
  await expect(page.getByText('놓으면 이 대화 파일로 저장')).toBeVisible()
  await drop(own, await dataTransfer(page, [{ name: 'dnd-own.txt', content: 'own' }]))
  await expect(page.getByText('1개 파일을 업로드했습니다.')).toBeVisible()
  await expect(own).toContainText('dnd-own.txt')
  await expect(page.getByText('놓으면 이 대화 파일로 저장')).toBeHidden()

  const chat = page.getByTestId('chat-dropzone')
  await drop(chat, await dataTransfer(page, [{ name: 'empty.txt', content: '' }]))
  await expect(page.getByText('폴더·빈 파일 1개는 올릴 수 없어 제외했습니다.')).toBeVisible()
  await expect(page.getByText('empty.txt')).toHaveCount(0)

  await page.getByRole('button', { name: '팀 의견 (AI 미전송)' }).click()
  await drop(chat, await dataTransfer(page, [{ name: 'dnd-note.txt', content: 'note' }]))
  await expect(page.getByText('dnd-note.txt')).toBeVisible()
  await expect(page.getByRole('button', { name: /첨부 (제거|취소)$/ })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /입력으로 고정|이번 메시지만/ })).toHaveCount(0)
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('끌어다 놓은 파일 공유')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByText('끌어다 놓은 파일 공유')).toBeVisible()
  await expect(own).toContainText('dnd-note.txt')
  await expect(page.getByRole('list', { name: '첨부', exact: true })).toHaveCount(0)
})
