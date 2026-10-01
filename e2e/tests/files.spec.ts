import { expect, test } from '@playwright/test'

const password = 'e2e-password-1234'

async function signUp(page: import('@playwright/test').Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-files-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function openMaterials(page: import('@playwright/test').Page) {
  await page.getByRole('tablist', { name: '보조 패널' }).getByRole('tab', { name: '자료' }).click()
}

test('S1 첨부를 입력에 고정하고 새 버전은 직접 전환한다', async ({ page }) => {
  await signUp(page)
  await page.getByRole('link', { name: /새 대화/ }).first().click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'e2e-note.txt', mimeType: 'text/plain', buffer: Buffer.from('first') })
  await expect(page.getByText('입력으로 고정')).toBeVisible()
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page).toHaveURL(/\/c\/[^/]+$/)
  await openMaterials(page)
  await expect(page.getByTestId('materials-inputs')).toContainText('e2e-note.txt v1')
  await page.getByRole('tab', { name: '이 대화 파일' }).click()
  await expect(page.getByTestId('materials-own')).toContainText('e2e-note.txt v1')
  await page.getByTestId('materials-own').locator('input[type="file"]').setInputFiles({ name: 'e2e-note.txt', mimeType: 'text/plain', buffer: Buffer.from('second') })
  await expect(page.getByTestId('materials-own')).toContainText('e2e-note.txt v2')
  await page.getByRole('tab', { name: 'AI 입력' }).click()
  await expect(page.getByTestId('materials-inputs')).toContainText('e2e-note.txt v1')
  await page.getByRole('button', { name: '새 버전 있음 · 바꾸기' }).click()
  await expect(page.getByTestId('materials-inputs')).toContainText('e2e-note.txt v2')
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('새 버전으로 다시 답변해 줘')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByRole('button', { name: '사용한 자료' })).toHaveCount(2, { timeout: 15_000 }) // 두 번째 답변의 기록 버튼이 생길 때까지(live는 가짜 서버 응답이 느리다) — last()만 보면 첫 기록을 연다
  await page.getByRole('button', { name: '사용한 자료' }).last().click()
  await expect(page.getByRole('dialog')).toContainText('e2e-note.txt')
  await expect(page.getByRole('dialog')).toContainText('v2')
})

test('S4 직접 공유 파일의 주 입력과 참고 입력이 순서대로 표시된다', async ({ page }) => {
  await signUp(page)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const tag = `files-${Date.now()}`
  const source = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, tags: [tag] } })).json() as { id: string }
  await page.request.post('/api/files', { multipart: { originTaskId: source.id, file: { name: 'main.txt', mimeType: 'text/plain', buffer: Buffer.from('main') } } })
  await page.request.post('/api/files', { multipart: { originTaskId: source.id, file: { name: 'reference.txt', mimeType: 'text/plain', buffer: Buffer.from('reference') } } })
  const consumer = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, tags: [tag] } })).json() as { id: string }
  await page.goto(`/c/${consumer.id}`)
  await openMaterials(page)
  await page.getByRole('tab', { name: '공유 자료함' }).click()
  await expect(page.getByTestId('materials-shared')).toContainText('main.txt v1')
  // 선택되면 aria-label이 '입력 해제'로 바뀌어 같은 로케이터가 사라진다 → check() 대신 click() 후 새 라벨로 확인
  await page.getByRole('checkbox', { name: 'reference.txt 참고 입력으로 선택' }).click()
  await expect(page.getByRole('checkbox', { name: 'reference.txt 입력 해제' })).toBeChecked()
  await page.getByRole('button', { name: 'main.txt 주 입력으로 지정' }).click()
  await page.getByRole('tab', { name: 'AI 입력' }).click()
  await expect(page.getByTestId('materials-inputs')).toContainText('주 입력')
  await expect(page.getByTestId('materials-inputs')).toContainText('참고')
  await expect(page.getByTestId('materials-inputs').locator('[data-testid^="selected-file-"]')).toHaveText([/main.txt v1.*주 입력/, /reference.txt v1.*참고/])
})

test('S3 같은 산출물 이름으로 두 번 저장하면 v2가 된다', async ({ page }) => {
  await signUp(page)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string; threadId: string; code: string }
  await page.goto(`/c/${task.id}`)
  let defaultName = ''
  for (let version = 1; version <= 2; version++) {
    await page.getByRole('textbox', { name: '팀 의견 입력' }).fill(`산출물 답변 ${version}`)
    await page.getByRole('button', { name: '전송', exact: true }).click()
    await expect(page.getByRole('button', { name: '산출물로 저장' }).last()).toBeVisible()
    await page.getByRole('button', { name: '산출물로 저장' }).last().click()
    const dialog = page.getByRole('dialog')
    const name = await dialog.getByLabel('파일 이름').inputValue()
    if (version === 1) { expect(name).toMatch(new RegExp(`_${task.code}\\.md$`)); defaultName = name }
    else expect(name).toBe(defaultName)
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
  await openMaterials(page)
  await page.getByRole('tab', { name: '이 대화 파일' }).click()
  await expect(page.getByTestId('materials-own')).toContainText(`${task.code}.md v2`)
  await page.getByTestId('materials-own').getByRole('button', { name: '버전 기록' }).last().click()
  await expect(page.getByRole('dialog')).toContainText(`${task.code}.md v1`)
  await expect(page.getByRole('dialog')).toContainText(`${task.code}.md v2`)
})
