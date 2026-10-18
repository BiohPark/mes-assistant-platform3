import { materialToggleName, revealMaterials } from './materials.js'
import { expect, test } from '@playwright/test'

const password = 'e2e-password-1234'

async function signUp(page: import('@playwright/test').Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-files-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function openMaterials(page: import('@playwright/test').Page) {
  await revealMaterials(page)
}

test('S1 첨부는 그 요청에만 가고 자료함에 남으며(사용됨), 첨부한 버전은 새 버전으로 직접 전환한다', async ({ page }) => {
  await signUp(page)
  await page.getByRole('link', { name: /새 대화/ }).first().click()
  await page.locator('[data-tour="composer"] input[type="file"]').setInputFiles({ name: 'e2e-note.txt', mimeType: 'text/plain', buffer: Buffer.from('first') })
  await expect(page.getByText('e2e-note.txt', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /입력으로 고정|이번 메시지만/ })).toHaveCount(0)
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page).toHaveURL(/\/c\/[^/]+$/)
  await openMaterials(page)
  // D54 개정: 첨부는 자료함에 남고 그 요청에만 갔다 — 입력창 첨부 칩은 비고 '사용됨'이 붙는다
  const chips = page.getByRole('list', { name: '첨부', exact: true })
  await expect(page.getByTestId('materials-own')).toContainText('e2e-note.txt')
  await expect(page.getByTestId('materials-own').getByText('사용됨')).toBeVisible()
  await expect(chips).toHaveCount(0)
  await page.getByTestId('materials-own').locator('input[type="file"]').setInputFiles({ name: 'e2e-note.txt', mimeType: 'text/plain', buffer: Buffer.from('second') })
  await expect(page.getByTestId('materials-own').getByRole('button', { name: 'e2e-note.txt', exact: true })).toHaveCount(2)
  const taskId = new URL(page.url()).pathname.split('/')[2]!
  const versions = await (await page.request.get(`/api/tasks/${taskId}/files`)).json() as Array<{ id: string; version: number }>
  expect(versions.map(file => file.version).sort()).toEqual([1, 2])
  // 기본 목록은 버전을 숨긴다. 고정 ID로 v1을 다시 골라 사람이 새 버전으로 바꾼다.
  const original = versions.find(file => file.version === 1)!
  await page.getByTestId(`file-${original.id}`).getByRole('button', { name: materialToggleName('e2e-note.txt') }).click()
  await expect(chips.getByRole('listitem')).toHaveAttribute('title', /e2e-note\.txt v1/)
  await page.getByRole('button', { name: '새 버전 있음 · 바꾸기' }).click()
  await expect(chips.getByRole('listitem')).toHaveAttribute('title', /e2e-note\.txt v2/)
  await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill('새 버전으로 다시 답변해 줘')
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
  await expect(page.getByTestId('materials-shared')).toContainText('main.txt')
  // 자료함에서 [첨부]하고 ★는 입력창 칩에서 바꾼다 — 칩은 전송과 같은 조립 순서(주 입력 먼저)
  const reference = page.getByRole('button', { name: materialToggleName('reference.txt') })
  await reference.click()
  await expect(reference).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: materialToggleName('main.txt') }).click()
  const chips = page.getByRole('list', { name: '첨부', exact: true })
  await expect(chips.getByRole('listitem')).toHaveText(['reference.txt', 'main.txt'])
  await chips.getByRole('button', { name: 'main.txt 주 입력 전환' }).click()
  await expect(chips.getByRole('button', { name: 'main.txt 주 입력 전환' })).toHaveAttribute('aria-pressed', 'true')
  await expect(chips.getByRole('listitem')).toHaveText(['main.txt', 'reference.txt'])
})

test('S3 같은 산출물 이름으로 두 번 저장하면 v2가 된다', async ({ page }) => {
  await signUp(page)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string; threadId: string; code: string }
  await page.goto(`/c/${task.id}`)
  let defaultName = ''
  for (let version = 1; version <= 2; version++) {
    await page.getByRole('textbox', { name: 'AI 요청 입력' }).fill(`산출물 답변 ${version}`)
    await page.getByRole('button', { name: '전송', exact: true }).click()
    await expect(page.getByRole('button', { name: '이 대화 파일로 저장' }).last()).toBeVisible({ timeout: 15_000 }) // 답변 완료까지 — 병렬 부하에서 5초를 넘긴다
    await page.getByRole('button', { name: '이 대화 파일로 저장' }).last().click()
    const dialog = page.getByRole('dialog')
    const name = await dialog.getByLabel('파일 이름').inputValue()
    if (version === 1) { expect(name).toMatch(new RegExp(`_${task.code}\\.md$`)); defaultName = name }
    else expect(name).toBe(defaultName)
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
  await openMaterials(page)
  await expect(page.getByTestId('materials-own')).toContainText(defaultName)
  await page.getByTestId('materials-own').getByRole('button', { name: '버전 기록' }).last().click()
  await expect(page.getByRole('dialog')).toContainText(`${task.code}.md v1`)
  await expect(page.getByRole('dialog')).toContainText(defaultName)
})
