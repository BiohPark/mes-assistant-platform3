import { expect, test, type Page } from '@playwright/test'
import type { ServiceRequest } from '../../packages/domain/src/types.js'

type SrDetail = ServiceRequest & { candidateAttachmentIds: string[]; taskCount: number; elapsedDays: number; conversations: Array<{ id: string; code: string; title: string; status: string; threadId: string | null; assigneeIds: string[] }> }

const row = (id: string, elapsedDays: number, updatedAt = '2026-10-12T00:00:00.000Z'): SrDetail => ({
  id, code: `SR-2026-${id}`, requesterId: 'u', title: `요청 ${id}`, titleSource: 'manual', body: '접수 본문', status: 'submitted',
  threadId: `thread-${id}`, attachmentIds: [], candidateAttachmentIds: [], results: [], conversations: [], taskCount: 0, elapsedDays,
  submittedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z', updatedAt,
})

// UI·GET 재조회 경계는 결정적인 SSE 전송으로 검증한다. 서버 권한·실제 재전송은 SR DB 테스트에서 검증한다.
async function setup(page: Page, getRows: () => SrDetail[], requester = false) {
  await page.addInitScript(() => {
    class QueueEventSource extends EventTarget {
      private relay = (event: Event) => {
        const { name, data } = (event as CustomEvent<{ name: string; data: unknown }>).detail
        this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }))
      }
      constructor() { super(); window.addEventListener('sr-queue-sse', this.relay) }
      close() { window.removeEventListener('sr-queue-sse', this.relay) }
    }
    Object.defineProperty(window, 'EventSource', { value: QueueEventSource })
  })
  // '**/api/**' 글롭은 Vite dev 모듈(/src/api/*.ts)까지 가로챈다 — 경로 접두로만 고른다
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url()), path = url.pathname
    let json: unknown = []
    if (path === '/api/me') json = { id: 'u', name: '사용자', role: '', roles: [requester ? 'requester' : 'member'], theme: 'system', locale: 'ko', email: null, emailIsDefault: false }
    else if (path === '/api/service-requests') json = getRows()
    else if (path === '/api/service-requests/intake-assistant') json = { srIntakeAssistantId: null }
    else if (path.startsWith('/api/service-requests/')) json = getRows().find(sr => sr.id === path.split('/')[3])
    else if (path === '/api/notifications/unread-count') json = { count: 0 }
    await route.fulfill({ json })
  })
}

async function emit(page: Page, name: string, data: unknown = {}) {
  await page.evaluate(({ name, data }) => window.dispatchEvent(new CustomEvent('sr-queue-sse', { detail: { name, data } })), { name, data })
}

test('SR queue sorts elapsed days, filters unstarted / my linked, and shows codes and empty-state link', async ({ page }) => {
  const rows = [row('0001', 1), row('0002', 5), row('0003', 5, '2026-10-11T00:00:00.000Z'),
    { ...row('0004', 2), status: 'in_progress' as const, taskCount: 1, conversations: [{ id: 'task', code: 'C-0042', title: '연결 대화', status: 'in_progress', threadId: 'h', assigneeIds: ['u'] }] },
    { ...row('0005', 10), status: 'reviewing' as const, taskCount: 1, conversations: [{ id: 'other', code: 'C-0043', title: '다른 대화', status: 'done', threadId: 'h2', assigneeIds: ['other'] }] },
  ]
  await setup(page, () => rows)
  await page.goto('/sr/manage')
  await expect(page.getByRole('link', { name: 'C-0042' })).toHaveAttribute('href', '/c/task')
  await page.getByRole('button', { name: '미착수', exact: true }).click()
  const table = page.getByRole('table')
  await expect(table.getByRole('row').filter({ has: page.getByRole('cell') }).getByRole('button')).toHaveText([
    /SR-2026-0003\s*요청 0003/, /SR-2026-0002\s*요청 0002/, /SR-2026-0001\s*요청 0001/,
  ])
  await page.getByRole('button', { name: '내 연결 SR', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table).toContainText('C-0042')
  await page.getByRole('button', { name: '완료', exact: true }).click()
  await expect(page.getByText('내가 담당하는 연결 SR이 없습니다.')).toBeVisible()
  await expect(page.getByRole('link', { name: '내 SR 요청', exact: true }).last()).toHaveAttribute('href', '/sr')
})

test('sr.updated and resync reread GET lists without duplicate rows', async ({ page }) => {
  let rows = [row('0001', 3)]
  let reads = 0
  await setup(page, () => { reads++; return rows })
  await page.goto('/sr/manage')
  await expect(page.getByRole('table')).toContainText('요청 0001')
  const before = reads
  rows = [{ ...rows[0]!, title: '서버의 최신 제목' }]
  await emit(page, 'sr.updated', { srId: '0001' })
  await expect.poll(() => reads).toBeGreaterThan(before)
  await expect(page.getByRole('table')).toContainText('서버의 최신 제목')
  const updatedReads = reads
  await emit(page, 'resync')
  await expect.poll(() => reads).toBeGreaterThan(updatedReads)
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2)
  const resyncReads = reads
  await emit(page, 'sr.updated', { srId: '0001' })
  await expect.poll(() => reads).toBeGreaterThan(resyncReads)
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2)
})

test('requester dirty sheet survives SSE list refresh and saving warns on changed updatedAt', async ({ page }) => {
  let sr = row('0001', 3), writes = 0, reads = 0
  await setup(page, () => { reads++; return [sr] }, true)
  page.on('request', request => { if (request.method() === 'PATCH' && request.url().endsWith('/content')) writes++ })
  await page.goto('/sr?id=0001')
  await page.getByRole('button', { name: '접수 내용 수정', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('SR 제목').fill('편집 중인 제목')
  await sheet.getByLabel('SR 본문').fill('편집 중인 본문')
  const before = reads
  sr = { ...sr, title: '외부 변경', body: '외부 본문', updatedAt: '2026-10-13T00:00:00.000Z' }
  await emit(page, 'sr.updated', { srId: sr.id })
  await expect.poll(() => reads).toBeGreaterThan(before)
  await expect(page.locator('h1').filter({ hasText: '외부 변경' })).toHaveText('외부 변경')
  await expect(sheet.getByLabel('SR 제목')).toHaveValue('편집 중인 제목')
  await expect(sheet.getByLabel('SR 본문')).toHaveValue('편집 중인 본문')
  await sheet.getByRole('button', { name: '저장', exact: true }).click()
  await expect(sheet.getByRole('alert')).toContainText('다른 변경')
  expect(writes).toBe(0)
  await expect(sheet).toBeVisible()
})
