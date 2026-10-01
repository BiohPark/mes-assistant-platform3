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
    const assistants = await (await owner.request.get('/api/assistants')).json() as Array<{ id: string }>
    expect(assistants.length).toBeGreaterThan(0)
    expect((await owner.request.patch('/api/settings', { data: { srIntakeAssistantId: assistants[0]!.id } })).ok()).toBe(true)
    expect((await owner.request.put(`/api/users/${requesterId}/business-owner`, { data: { enabled: true } })).status()).toBe(204)
    await page.request.post('/api/auth/logout')
    expect((await page.request.post('/api/auth/login', { data: { loginId, password } })).ok()).toBe(true)

    await page.goto('/sr')
    await page.getByRole('button', { name: '접수 대화 시작' }).click()
    let rows: Array<{ id: string; threadId: string }> = []
    await expect.poll(async () => { rows = await (await page.request.get('/api/service-requests')).json() as typeof rows; return rows.length }).toBeGreaterThan(0) // 생성이 끝날 때까지 — 클릭 직후 조회하면 비어 있다
    srId = rows[0]!.id
    const attachment = await page.request.post(`/api/service-requests/${srId}/files`, { multipart: { file: { name: 'sr-e2e.txt', mimeType: 'text/plain', buffer: Buffer.from('현장 알람') } } })
    expect(attachment.ok()).toBe(true)
    const fileId = ((await attachment.json()) as { id: string }).id
    const sent = await page.request.post(`/api/threads/${rows[0]!.threadId}/messages`, { data: { content: '알람 필터 요청', kind: 'discussion', attachmentIds: [fileId] } })
    expect(sent.ok()).toBe(true)
    await expect.poll(async () => (await (await page.request.get(`/api/threads/${rows[0]!.threadId}/messages`)).json() as Array<{ attachmentIds: string[] }>)[0]?.attachmentIds).toEqual([fileId])
    await page.reload()
    await expect(page.getByRole('region', { name: '접수 대화' })).toContainText('알람 필터 요청')
    await page.getByRole('button', { name: '접수로 전환' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('SR 제목')).not.toBeEmpty()
    await dialog.getByRole('button', { name: '접수 제출' }).click()
    await expect(dialog).toBeHidden()
    const submitted = await (await page.request.get(`/api/service-requests/${srId}`)).json() as { code: string }
    srCode = submitted.code
    expect(submitted.code).toMatch(/^SR-\d{4}-\d{4}$/)

    const started = await owner.request.post(`/api/service-requests/${srId}/tasks`, { data: { assistantId: assistants[0]!.id } })
    expect(started.ok()).toBe(true)
    const task = await started.json() as { id: string; threadId: string; tags: string[] }
    taskId = task.id
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
