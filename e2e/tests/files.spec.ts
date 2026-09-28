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
  await page.getByRole('button', { name: '전송' }).click()
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
})

test('S4 직접 공유 태그의 파일을 주 입력으로 고른다', async ({ page }) => {
  await signUp(page)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const tag = `files-${Date.now()}`
  const source = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, tags: [tag] } })).json() as { id: string }
  await page.request.post('/api/files', { multipart: { originTaskId: source.id, file: { name: 'shared.txt', mimeType: 'text/plain', buffer: Buffer.from('shared') } } })
  const consumer = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, tags: [tag] } })).json() as { id: string }
  await page.goto(`/c/${consumer.id}`)
  await openMaterials(page)
  await page.getByRole('tab', { name: '공유 자료함' }).click()
  await expect(page.getByTestId('materials-shared')).toContainText('shared.txt v1')
  await page.getByRole('button', { name: 'shared.txt 주 입력으로 지정' }).click()
  await page.getByRole('tab', { name: 'AI 입력' }).click()
  await expect(page.getByTestId('materials-inputs')).toContainText('주 입력')
  await expect(page.getByTestId('materials-inputs')).toContainText('shared.txt v1')
})

test('S3 같은 산출물 이름으로 두 번 저장하면 v2가 된다', async ({ page }) => {
  await signUp(page)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string }
  await page.request.post(`/api/tasks/${task.id}/outputs`, { data: { name: 'answer.md', content: '# first' } })
  await page.request.post(`/api/tasks/${task.id}/outputs`, { data: { name: 'answer.md', content: '# second' } })
  await page.goto(`/c/${task.id}`)
  await openMaterials(page)
  await page.getByRole('tab', { name: '이 대화 파일' }).click()
  await expect(page.getByTestId('materials-own')).toContainText('answer.md v2')
  await page.getByTestId('materials-own').getByRole('button', { name: '버전 기록' }).last().click()
  await expect(page.getByRole('dialog')).toContainText('answer.md v1')
  await expect(page.getByRole('dialog')).toContainText('answer.md v2')
})
