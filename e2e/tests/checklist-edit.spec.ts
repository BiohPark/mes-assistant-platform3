import { openWorkTool } from './materials.js'
import { expect, test } from '@playwright/test'

test('체크한 항목의 문구를 고치면 체크는 유지되고 이력에 남으며 AI 점검 결과는 무효화된다', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`s16-ck-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)

  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string }
  const items = await (await page.request.post(`/api/tasks/${task.id}/checklist`, { data: { label: '근거 확인' } })).json() as Array<{ id: string; label: string }>
  const item = items.find((entry) => entry.label === '근거 확인')!
  expect((await page.request.patch(`/api/tasks/${task.id}/checklist/${item.id}`)).ok()).toBe(true)
  expect((await page.request.post(`/api/tasks/${task.id}/checklist/review`)).ok()).toBe(true)

  await page.goto(`/c/${task.id}`)
  await openWorkTool(page, '체크리스트')
  const checklist = page.getByTestId('checklist-panel')
  await expect(checklist.getByRole('checkbox', { name: '근거 확인' })).toBeChecked()
  await expect(checklist.getByText(/^\d+\/\d+ 달성/)).toBeVisible()

  await checklist.getByRole('button', { name: '근거 확인 수정' }).click()
  const input = checklist.getByRole('textbox', { name: '근거 확인 문구' })
  await expect(input).toBeFocused()
  await input.fill('근거 자료 확인')
  await input.press('Enter')

  await expect(checklist.getByRole('checkbox', { name: '근거 자료 확인' })).toBeChecked()
  await expect(checklist.getByRole('checkbox', { name: '근거 확인', exact: true })).toHaveCount(0)
  await expect(checklist.getByText('점검 결과가 없습니다.')).toBeVisible()

  await openWorkTool(page, '활동 이력')
  await expect(page.getByText('근거 확인 → 근거 자료 확인').filter({ visible: true })).toBeVisible()
  await expect(page.getByText('체크리스트 문구 수정').filter({ visible: true })).toBeVisible()
})
