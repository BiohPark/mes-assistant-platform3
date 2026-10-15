import { expect, test } from '@playwright/test'
import type { Message, ServiceRequest, SrStatusChange } from '../../packages/domain/src/types.js'

type SrDetail = ServiceRequest & {
  requesterName: string; elapsedDays: number; candidateAttachmentIds: string[]
  intakeMessages: Message[]; statusHistory: SrStatusChange[]
  conversations: Array<{ id: string; code: string; title: string; status: string; threadId: string }>
}

for (const width of [360, 1280]) {
  test(`SR detail prioritizes actions and request content without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const sr: SrDetail = {
      id: 'detail', code: 'SR-2026-0001', title: '긴요청제목'.repeat(15), titleSource: 'manual', body: '처리자가 먼저 확인할 요청 본문',
      requesterId: 'u', requesterName: '김요청', status: 'responded', submittedAt: '2026-10-01T09:00:00Z', elapsedDays: 14,
      attachmentIds: ['attachment'], candidateAttachmentIds: ['attachment'], threadId: 'intake', createdAt: '2026-10-01', updatedAt: '2026-10-15',
      conversations: [{ id: 'task', code: 'WK-0001', title: '연결 업무', status: 'in_progress', threadId: 'work' }],
      results: [{ id: 'result', text: '공유된 처리 결과', fileIds: ['result-file'], by: 'u', byName: '담당자', at: '2026-10-14' }],
      intakeMessages: [
        { id: 'user', threadId: 'intake', role: 'user', content: '**요청자 원문**', status: 'done', attachmentIds: [], createdAt: '2026-10-01' },
        { id: 'ai', threadId: 'intake', role: 'assistant', content: ['**AI 답변**', '둘째 줄', '셋째 줄', '넷째 줄', '다섯째 줄'].join('\n'), status: 'done', attachmentIds: [], createdAt: '2026-10-01' },
      ],
      statusHistory: [
        { id: 'h1', from: 'draft', to: 'submitted', by: 'u', at: '2026-10-01' },
        { id: 'h2', from: 'in_progress', to: 'responded', by: 'u', byName: '담당자', at: '2026-10-14' },
      ],
    }
    await page.addInitScript(() => { localStorage.setItem('mes-locale', 'ko') })
    await page.route(url => url.pathname.startsWith('/api/'), async route => {
      const path = new URL(route.request().url()).pathname
      let json: unknown = []
      if (path === '/api/me') json = { id: 'u', name: '담당자', role: '', roles: ['member'], theme: 'system', locale: 'ko', email: null, emailIsDefault: false }
      else if (path === '/api/service-requests') json = [sr]
      else if (path === '/api/service-requests/detail') json = sr
      else if (path === '/api/notifications/unread-count') json = { count: 0 }
      else if (path.startsWith('/api/files/')) json = { id: path.split('/').at(-1), name: `${'긴파일이름'.repeat(20)}.txt`, version: 1, size: 10, source: 'upload' }
      await route.fulfill({ json })
    })
    await page.goto('/sr/manage')
    await page.getByRole('button', { name: new RegExp(sr.code) }).click()
    const sheet = page.getByRole('dialog')
    const content = sheet.getByRole('region', { name: '접수 내용' })
    await expect(content).toContainText(sr.body)
    const start = sheet.getByRole('button', { name: '연결 업무 시작' })
    await expect(start).toBeDisabled()
    await expect(sheet.getByRole('combobox', { name: '연결 업무 에이전트' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: '완료', exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: '반려', exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: '결과 공유', exact: true })).toBeVisible()
    const startBox = await start.boundingBox(), contentBox = await content.boundingBox()
    expect(startBox!.y + startBox!.height).toBeLessThanOrEqual(contentBox!.y)
    await expect(content.getByRole('button', { name: '다운로드' })).toBeVisible()
    await expect(content.getByRole('button', { name: '버전 기록' })).toBeVisible()
    await expect(sheet.getByRole('list', { name: '요청 진행 단계' }).getByText('처리 중')).toHaveAttribute('aria-current', 'step')
    const intake = sheet.getByRole('button', { name: '접수 대화 보기 · 메시지 2개' })
    await expect(intake).toHaveAttribute('aria-expanded', 'false')
    await expect(sheet.getByRole('region', { name: '접수 대화' })).toBeHidden()
    const history = sheet.getByRole('list', { name: '상태 이력' })
    await expect(history.getByRole('listitem')).toHaveCount(1)
    await sheet.getByRole('button', { name: '전체 보기' }).click()
    await expect(history.getByRole('listitem')).toHaveCount(2)
    await intake.click()
    const conversation = sheet.getByRole('region', { name: '접수 대화' })
    await expect(conversation.locator('strong').filter({ hasText: '요청자 원문' })).toBeVisible()
    const preview = conversation.locator('p.line-clamp-3')
    await expect(preview).toHaveCSS('-webkit-line-clamp', '3')
    expect(await preview.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    await conversation.getByRole('button', { name: '펼치기' }).click()
    await expect(conversation.locator('strong').filter({ hasText: 'AI 답변' })).toBeVisible()
    await expect(sheet.getByRole('link', { name: /WK-0001/ })).toHaveAttribute('href', '/c/task')
    expect(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
}
