import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'

test('데모 이관 계정은 비밀번호 변경 후 대화와 파일을 본다', async ({ page }) => {
  const key = `e2e-import-${Date.now()}`
  const at = '2026-09-01T00:00:00.000Z'
  const folder = await mkdtemp(join(tmpdir(), 'mes-import-e2e-'))
  const file = join(folder, 'bundle.json')
  const user = `${key}-user`
  const assistant = 'deviation-drafter' // 시드 에이전트 재사용 — 새 카드를 남기면 같은 DB를 쓰는 home.spec 카드 수가 깨진다(이관은 기존 행을 건너뜀)
  const task = `${key}-task`
  const thread = `${key}-thread`
  const asset = `${key}-file`
  const bundle = { format: 'mes-assistant-hub', version: 3, exportedAt: at, tables: {
    users: [{ id: user, name: 'Virtual User', role: 'member', initials: 'VU', color: '#123456' }],
    tasks: [{ id: task, code: `WK-2099-${Date.now()}`, assistantId: assistant, title: 'Imported conversation', status: 'in_progress', ownerId: user,
      createdBy: user, createdAt: at, priority: 'normal', tags: [], inputs: [], outputFileIds: [asset] }],
    threads: [{ id: thread, taskId: task, title: 'Imported conversation', createdBy: user, createdAt: at }],
    messages: [{ id: `${key}-message`, threadId: thread, role: 'user', content: 'Imported virtual message', authorId: user, createdAt: at, status: 'done' }],
    files: [{ id: asset, originTaskId: task, name: 'imported.txt', mime: 'text/plain', source: 'assistant', uploadedBy: user,
      uploadedAt: at, version: 1, blobBase64: Buffer.from('virtual file contents').toString('base64') }],
  } }
  try {
    await writeFile(file, JSON.stringify(bundle))
    const apiDir = resolve(import.meta.dirname, '../../apps/api')
    const output = execFileSync(process.execPath, [join(apiDir, 'dist/db/import.js'), file], { cwd: apiDir, env: process.env, encoding: 'utf8' })
    const credential = output.trim().split('\n').find((line) => line.startsWith('demo-'))?.split('\t')
    expect(credential).toHaveLength(2)
    const [loginId, temporaryPassword] = credential!
    await page.goto('/login')
    await page.getByLabel('ID').fill(loginId!)
    await page.getByLabel('비밀번호').fill(temporaryPassword!)
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.getByText('비밀번호를 변경해야 계속할 수 있습니다')).toBeVisible()
    await page.getByLabel('현재 비밀번호').fill(temporaryPassword!)
    await page.getByLabel('새 비밀번호', { exact: true }).fill('virtual-new-password-1234')
    await page.getByLabel('새 비밀번호 확인').fill('virtual-new-password-1234')
    await page.getByRole('button', { name: '변경', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.getByLabel('ID').fill(loginId!)
    await page.getByLabel('비밀번호').fill('virtual-new-password-1234')
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page).not.toHaveURL(/\/login$/) // 로그인 완료 전에 이동하면 세션 없이 로그인 화면으로 돌아온다
    await page.goto(`/c/${task}`)
    await expect(page.getByText('Imported virtual message')).toBeVisible()
    await page.getByRole('tablist', { name: '보조 패널' }).getByRole('tab', { name: '자료' }).click()
    await page.getByRole('tab', { name: '이 대화 파일' }).click()
    await expect(page.getByTestId('materials-own')).toContainText('imported.txt v1')
  } finally { await rm(folder, { recursive: true, force: true }) }
})
