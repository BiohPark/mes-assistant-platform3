import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createT } from '@/i18n'
import { DiagnosticsPage, formatDiagnostics } from './DiagnosticsPage'
vi.mock('@/app/TopBar', () => ({ TopBar: ({ title }: { title: string }) => <h1>{title}</h1> }))

const data = {
  app: { version: '0.1.0', commit: 'abc123', builtAt: '2026-10-08T00:00:00Z', node: 'v22', os: 'win32' },
  db: { version: '11.8', charset: 'utf8mb4', collation: 'utf8mb4_nopad_bin', migrations: 4 },
  llm: { mode: 'live', preset: 'openwebui', baseUrlHost: 'llm.example.com', defaultModel: 'm', ok: true, detail: '연결 성공', ms: 42 },
  storage: { path: 'D:\\mes-hub\\storage', writable: true, freeBytes: 1024 }, trustProxy: false,
  settings: { authMode: 'local', apiPort: 3000, fileMaxBytes: 100, fileMaxPerRequest: 2, requestMaxActive: 20 },
  secrets: { databasePassword: true, sessionSecret: true, llmApiKey: true, oidcClientSecret: false, devUserPassword: false },
  recentErrors: [{ at: '2026-10-08', path: '/api/test', status: 500, message: 'HTTP 500' }],
}
afterEach(() => vi.unstubAllGlobals())

it('진단을 다시 조회하고 허용된 값만 평문 복사한다', async () => {
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...data, leakedSecret: 'hidden-key' }), { status: 200, headers: { 'content-type': 'application/json' } })))
  vi.stubGlobal('navigator', { clipboard: { writeText: async (value: string) => { writes.push(value) } } })
  renderWithProviders(<DiagnosticsPage />)
  expect(await screen.findByText('llm.example.com')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '텍스트로 복사' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toContain('abc123')
  expect(writes[0]).not.toContain('hidden-key')
  fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
})

it('진단 평문은 비밀 설정의 존재 여부만 담는다', () => {
  const response = { ...data, trustProxy: false as const, leakedSecret: 'hidden-key' }
  const text = formatDiagnostics(response, createT('ko'))
  expect(text).toContain('SESSION_SECRET: 설정됨')
  expect(text).not.toContain('hidden-key')
})
