import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { createPool } from '../../apps/api/src/db/connection.js'
import { FileStorageService } from '../../apps/api/src/files/fileStorage.service.js'

const password = 'e2e-password-1234'

test('E1 S2 접수 첨부와 요청자 범위, 연결 업무 및 결과 공유', async ({ page, browser }) => {
  const loginId = `sr-${Date.now().toString(36)}`
  expect(loginId.length).toBeLessThanOrEqual(32)
  const ownerContext = await browser.newContext({ baseURL: process.env.APP_ORIGIN ?? 'http://localhost:5173' })
  const owner = await ownerContext.newPage()
  let srId = '', taskId = '', srCode = '', originalIntake: string | null | undefined, requesterId = ''
  try {
    const signup = await page.request.post('/api/auth/signup', { data: { loginId, password } })
    expect(signup.ok()).toBe(true)
    requesterId = ((await signup.json()) as { id: string }).id
    const ownerSignup = await owner.request.post('/api/auth/signup', { data: { loginId: 'dev-owner', password } })
    if (ownerSignup.status() === 409) expect((await owner.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
    else expect(ownerSignup.ok()).toBe(true)
    expect((await (await owner.request.get('/api/me')).json() as { roles: string[] }).roles).toContain('system_owner')
    const settings = await (await owner.request.get('/api/settings')).json() as { srIntakeAssistantId?: string | null }
    originalIntake = settings.srIntakeAssistantId ?? null
    const assistants = await (await owner.request.get('/api/assistants')).json() as Array<{ id: string; name: string; status: string }>
    expect(assistants.length).toBeGreaterThan(0)
    const intakeAssistant = assistants.find(item => item.status === 'open')!
    expect(intakeAssistant).toBeTruthy()
    expect((await owner.request.patch('/api/settings', { data: { srIntakeAssistantId: intakeAssistant.id } })).ok()).toBe(true)
    expect((await owner.request.put(`/api/users/${requesterId}/business-owner`, { data: { enabled: true } })).status()).toBe(204)
    await page.request.post('/api/auth/logout')
    expect((await page.request.post('/api/auth/login', { data: { loginId, password } })).ok()).toBe(true)

    let createCount = 0, intakeCount = 0, createKey = ''
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/service-requests') {
        createCount++; createKey = request.headers()['idempotency-key'] ?? ''
      }
    })
    // 이 흐름은 접수 UI/저장 경계를 검증한다. LLM 스트리밍 자체는 requests-live에서 검증한다.
    await page.route('**/api/threads/*/requests', async route => {
      intakeCount++
      const threadId = new URL(route.request().url()).pathname.split('/')[3]!
      const body = route.request().postDataJSON() as { content: string; attachmentIds: string[] }
      expect(route.request().headers()['idempotency-key']).toBeTruthy()
      const sent = await page.request.post(`/api/threads/${threadId}/messages`, { data: { content: body.content, kind: 'discussion', attachmentIds: body.attachmentIds } })
      expect(sent.ok()).toBe(true)
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: started\ndata: {"requestId":"e2e-intake","replyMessageId":"e2e-reply"}\n\nevent: completed\ndata: {}\n\n' })
    })
    await page.goto('/sr')
    const before = await (await page.request.get('/api/service-requests?scope=mine')).json() as Array<{ id: string }>
    await page.getByRole('button', { name: '새 요청' }).click()
    expect(await (await page.request.get('/api/service-requests?scope=mine')).json()).toEqual(before)
    expect(createCount).toBe(0)
    await expect(page.getByRole('button', { name: '접수로 전환' })).toHaveCount(0)
    await page.locator('input[type=file]').setInputFiles({ name: 'sr-e2e.txt', mimeType: 'text/plain', buffer: Buffer.from('현장 알람') })
    await page.getByRole('textbox', { name: '접수 메시지' }).fill('알람 필터 요청')
    await page.getByRole('textbox', { name: '접수 메시지' }).press('Enter')
    await expect.poll(() => new URL(page.url()).searchParams.get('id')).toBeTruthy()
    srId = new URL(page.url()).searchParams.get('id')!
    await expect.poll(() => intakeCount).toBe(1)
    expect(createCount).toBe(1)
    expect(createKey).toBeTruthy()
    const replay = await page.request.post('/api/service-requests', { headers: { 'Idempotency-Key': createKey } })
    expect(replay.ok()).toBe(true)
    expect(((await replay.json()) as { id: string }).id).toBe(srId)
    const rows = await (await page.request.get('/api/service-requests?scope=mine')).json() as Array<{ id: string; threadId: string }>
    expect(rows).toHaveLength(before.length + 1)
    const row = rows.find(item => item.id === srId)!
    await expect.poll(async () => (await (await page.request.get(`/api/threads/${row.threadId}/messages`)).json() as Array<unknown>).length).toBe(1)
    const sentMessages = await (await page.request.get(`/api/threads/${row.threadId}/messages`)).json() as Array<{ attachmentIds: string[] }>
    expect(sentMessages[0]!.attachmentIds).toHaveLength(1)
    const fileId = sentMessages[0]!.attachmentIds[0]!
    expect((await page.request.get(`/api/files/${fileId}`)).ok()).toBe(true)
    await page.unroute('**/api/threads/*/requests')
    await page.reload()
    await expect(page.getByRole('region', { name: '접수 대화' })).toContainText('알람 필터 요청')
    await page.getByRole('button', { name: '접수로 전환' }).click()
    // U9: 전환은 오른쪽 Sheet — AI 초안 로딩 후 제목이 채워지고, 첨부는 체크 목록(기본 전부 선택)으로 고른다.
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('SR 제목')).not.toBeEmpty()
    const attachmentCheck = dialog.getByRole('checkbox', { name: 'sr-e2e.txt' })
    await expect(attachmentCheck).toBeChecked()
    await attachmentCheck.click()
    await expect(attachmentCheck).not.toBeChecked()
    await attachmentCheck.click()
    await expect(attachmentCheck).toBeChecked()
    await dialog.getByRole('button', { name: '접수 제출' }).click()
    await expect(dialog).toBeHidden()
    const submitted = await (await page.request.get(`/api/service-requests/${srId}`)).json() as { code: string; attachmentIds: string[] }
    srCode = submitted.code
    expect(submitted.code).toMatch(/^SR-\d{4}-\d{4}$/)
    expect(submitted.attachmentIds).toEqual([fileId])

    await owner.goto('/sr/manage')
    await owner.getByRole('textbox', { name: 'SR 검색' }).fill(srCode)
    await owner.getByRole('button', { name: new RegExp(srCode) }).click()
    const sheet = owner.getByRole('dialog')
    await expect(sheet.getByRole('region', { name: '접수 대화' })).toContainText('알람 필터 요청')
    await expect(sheet.getByText('sr-e2e.txt v1')).toBeVisible()
    const picker = sheet.getByRole('combobox', { name: '연결 업무 에이전트' })
    await picker.fill(intakeAssistant.name)
    await owner.getByRole('option', { name: intakeAssistant.name, exact: true }).click() // 추천 목록은 포털로 시트 밖에 렌더링된다
    await sheet.getByRole('button', { name: '연결 업무 시작' }).click()
    await expect(owner).toHaveURL(/\/c\/[^/]+$/)
    taskId = new URL(owner.url()).pathname.split('/')[2]!
    const task = await (await owner.request.get(`/api/tasks/${taskId}`)).json() as { id: string; threadId: string; tags: string[] }
    expect(task.tags).toContain(submitted.code)
    const shared = await owner.request.post(`/api/tasks/${taskId}/outputs`, { data: { name: 'shared.md', content: '# 완료' } })
    const hidden = await owner.request.post(`/api/tasks/${taskId}/outputs`, { data: { name: 'internal.md', content: '# 내부' } })
    expect(shared.ok()).toBe(true)
    expect(hidden.ok()).toBe(true)
    const sharedId = ((await shared.json()) as { id: string }).id
    const hiddenId = ((await hidden.json()) as { id: string }).id
    expect((await owner.request.post(`/api/service-requests/${srId}/results`, { data: { taskId, text: '처리 완료', fileIds: [sharedId] } })).ok()).toBe(true)
    await page.reload()
    await expect(page.getByText('처리 완료')).toBeVisible()
    // U9: 완료는 사유 필수 — 처리 Sheet의 "다음 단계"(답변 공유 → 완료) → ReasonDialog. 서버는 사유 없는 완료를 400으로 막는다.
    expect((await owner.request.patch(`/api/service-requests/${srId}/status`, { data: { status: 'done' } })).status()).toBe(400)
    await owner.goto('/sr/manage')
    await owner.getByRole('textbox', { name: 'SR 검색' }).fill(srCode)
    await owner.getByRole('button', { name: new RegExp(srCode) }).click()
    await owner.getByRole('button', { name: '다음 단계: 완료' }).click()
    const reasonDialog = owner.getByRole('dialog', { name: 'SR 완료 사유' })
    await expect(reasonDialog.getByRole('button', { name: '확인' })).toBeDisabled()
    await reasonDialog.getByPlaceholder('사유를 입력하세요').fill('요청 범위 모두 처리')
    await reasonDialog.getByRole('button', { name: '확인' }).click()
    await expect(reasonDialog).toBeHidden()
    await expect(owner.getByRole('list', { name: '상태 이력' })).toContainText('사유: 요청 범위 모두 처리')
    const closed = await (await page.request.get(`/api/service-requests/${srId}`)).json() as { status: string; statusHistory: Array<{ to: string; reason?: string }> }
    expect(closed.status).toBe('done')
    expect(closed.statusHistory.at(-1)).toMatchObject({ to: 'done', reason: '요청 범위 모두 처리' })
    await page.reload()
    await page.getByRole('button', { name: '상태 이력' }).click()
    await expect(page.getByRole('list', { name: '상태 이력' })).toContainText('답변 공유 → 완료')
    await expect(page.getByRole('list', { name: '상태 이력' })).toContainText('사유: 요청 범위 모두 처리')
    expect((await page.request.get(`/api/tasks/${taskId}`)).status()).toBe(403)
    expect((await page.request.get(`/api/threads/${task.threadId}/messages`)).status()).toBe(403)
    expect((await page.request.get(`/api/files/${sharedId}/content`)).status()).toBe(200)
    expect((await page.request.get(`/api/files/${hiddenId}/content`)).status()).toBe(403)
  } finally {
    if (originalIntake !== undefined) {
      const restored = await owner.request.patch('/api/settings', { data: { srIntakeAssistantId: originalIntake } })
      expect(restored.ok()).toBe(true)
      const restoredSettings = await restored.json() as { srIntakeAssistantId?: string | null }
      expect(restoredSettings.srIntakeAssistantId ?? null).toBe(originalIntake)
    }
    if (requesterId) await owner.request.put(`/api/users/${requesterId}/business-owner`, { data: { enabled: false } })
    if (srId) {
      const pool = createPool(process.env.DATABASE_URL!, 1)
      const connection = await pool.getConnection()
      let storageKeys: string[] = []
      try {
        await connection.query('set foreign_key_checks = 0')
        const [stored] = await connection.execute('select storage_key from file_object where origin_sr_id = ? or origin_task_id = ?', [srId, taskId])
        storageKeys = (stored as Array<{ storage_key: string }>).map((row) => row.storage_key)
        await connection.execute('delete from shared_result_file where result_id in (select id from shared_result where sr_id = ?)', [srId])
        await connection.execute('delete from shared_result where sr_id = ?', [srId])
        await connection.execute('delete from notification where user_id = ?', [requesterId])
        if (srCode) await connection.execute('delete from notification where body like ?', [`%${srCode}%`])
        await connection.execute('delete from activity_log where sr_id = ? or task_id = ?', [srId, taskId])
        if (taskId) {
          await connection.execute('delete from file_object where origin_task_id = ?', [taskId])
          await connection.execute('delete from thread where task_id = ?', [taskId])
          await connection.execute('delete from task_tag where task_id = ?', [taskId])
          await connection.execute('delete from task_assignee where task_id = ?', [taskId])
          await connection.execute('delete from task where id = ?', [taskId])
        }
        await connection.execute('delete from message_attachment where message_id in (select id from message where thread_id in (select id from thread where sr_id = ?))', [srId])
        await connection.execute('delete from message where thread_id in (select id from thread where sr_id = ?)', [srId])
        await connection.execute('delete from file_object where origin_sr_id = ?', [srId])
        await connection.execute('delete from thread where sr_id = ?', [srId])
        await connection.execute('delete from service_request where id = ?', [srId])
        if (srCode) await connection.execute('delete from tag where `key` = ?', [srCode.toLowerCase()])
        await connection.execute('delete from app_user where id = ?', [requesterId])
      } finally { await connection.query('set foreign_key_checks = 1'); connection.release(); await pool.end() }
      const storage = new FileStorageService(resolve(import.meta.dirname, '../..', process.env.FILE_STORAGE_ROOT ?? 'storage'))
      for (const key of storageKeys) await storage.remove(key)
    }
    await ownerContext.close()
  }
})
