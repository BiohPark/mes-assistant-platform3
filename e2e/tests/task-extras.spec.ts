import { expect, test } from '@playwright/test'

test('체크리스트 점검, 첨부 노트, 완료 리포트와 재개', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`s4-extra-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)

  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string; code: string }
  const uploaded = await (await page.request.post('/api/files', { multipart: {
    originTaskId: task.id, file: { name: 's4-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('evidence') },
  } })).json() as { id: string }
  expect((await page.request.put(`/api/tasks/${task.id}/inputs/${uploaded.id}`, { data: { weight: 'main' } })).ok()).toBe(true)

  await page.goto(`/c/${task.id}`)
  await page.getByRole('tablist', { name: '보조 패널' }).getByRole('tab', { name: '체크' }).click()
  const checklist = page.getByTestId('checklist-panel')
  const addItem = checklist.locator('form button[type="submit"]')
  await checklist.getByRole('textbox', { name: '체크리스트 새 항목' }).fill('근거 확인')
  await expect(addItem).toHaveText('추가')
  await expect(addItem).toBeEnabled()
  await addItem.click()
  await checklist.getByRole('textbox', { name: '체크리스트 새 항목' }).fill('승인 확인')
  await expect(addItem).toBeEnabled()
  await addItem.click()
  await expect(checklist.getByRole('checkbox', { name: '승인 확인' })).toBeVisible()
  await checklist.getByRole('checkbox', { name: '근거 확인' }).click() // 서버 반영 뒤 바뀌는 체크박스 — check()의 즉시 검사와 맞지 않는다
  await expect(checklist.getByRole('checkbox', { name: '근거 확인' })).toBeChecked()
  await checklist.getByRole('button', { name: 'AI 달성도 점검' }).click()
  await expect(checklist.getByText(/규칙 판단/)).toBeVisible({ timeout: 15_000 })
  await checklist.getByRole('checkbox', { name: '근거 확인' }).click()
  await expect(checklist.getByRole('checkbox', { name: '근거 확인' })).not.toBeChecked()
  await checklist.getByRole('button', { name: '판단대로 체크' }).click()
  await expect(checklist.getByRole('checkbox', { name: '근거 확인' })).toBeChecked()
  await expect(checklist.getByRole('checkbox', { name: '승인 확인' })).not.toBeChecked()

  await page.getByRole('tablist', { name: '보조 패널' }).getByRole('tab', { name: '노트' }).click()
  const notes = page.getByTestId('notes-panel')
  await notes.getByRole('textbox', { name: '노트 본문' }).fill('완료 근거 메모')
  await expect(notes.getByRole('checkbox', { name: /s4-evidence.txt/ })).toBeVisible()
  await notes.getByRole('checkbox', { name: /s4-evidence.txt/ }).click()
  await expect(notes.getByRole('checkbox', { name: /s4-evidence.txt/ })).toBeChecked()
  await notes.getByRole('button', { name: '노트 추가' }).click()
  await expect(notes.getByText('완료 근거 메모')).toBeVisible()
  await expect(notes.getByText('s4-evidence.txt', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '업무 완료' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '4점' }).click()
  await dialog.getByRole('textbox', { name: '피드백 코멘트' }).fill('도움이 됨')
  await expect(dialog.getByText(/s4-evidence.txt v1/)).toBeVisible()
  // U9: 필수 체크 항목이 미완료면 완료 사유가 필수다.
  const completeReason = dialog.getByRole('textbox', { name: '완료 사유' })
  if (await completeReason.count()) await completeReason.fill('E2E 완료')
  await dialog.getByRole('button', { name: '완료 처리' }).click()
  await expect(page.getByRole('button', { name: '다시 열기' })).toBeVisible({ timeout: 15_000 })

  let reportId = ''
  await expect.poll(async () => {
    const files = await (await page.request.get(`/api/tasks/${task.id}/files`)).json() as Array<{ id: string; name: string; isOutput: boolean }>
    reportId = files.find((file) => file.name === `완료리포트_${task.code}.md` && file.isOutput)?.id ?? ''
    return reportId
  }, { timeout: 15_000 }).not.toBe('')
  const content = await (await page.request.get(`/api/files/${reportId}/content`)).text()
  expect(content).toContain('s4-evidence.txt v1')
  expect(content).toContain('★ 4 — 도움이 됨')

  await page.getByRole('button', { name: '다시 열기' }).click()
  await page.getByPlaceholder('사유를 입력하세요').fill('노트 정리')
  await page.getByRole('button', { name: '재개 확인' }).click()
  await expect(page.getByRole('button', { name: '업무 완료' })).toBeVisible()
  await notes.getByRole('button', { name: '삭제' }).click()
  await expect(notes.getByText('완료 근거 메모')).toHaveCount(0)
})
