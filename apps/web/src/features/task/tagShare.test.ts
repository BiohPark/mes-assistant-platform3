import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Candidates, FileCandidate } from '@/api/files'
import { resetBubbles, useBubbleStore } from '@/features/assistant-pill/bubbles'
import { changeTagWithShare, FRESH_MS, sharedItems, shareDiff, useTagShareStore } from './tagShare'

beforeEach(() => { resetBubbles(); useTagShareStore.setState({ byTask: {}, openSeq: {} }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const file = (id: string, sourceTaskId: string, extra: Partial<FileCandidate> = {}): FileCandidate => ({
  file: { id, name: `${id}.txt`, mime: 'text/plain', size: 1, sha256: 'x', version: 1, source: 'upload', isOutput: false, uploadedBy: 'u', uploadedAt: '2026-01-01' },
  sourceTaskId, viaTags: sourceTaskId === 't' ? [] : ['X'], role: 'upload', ...extra,
})
const conversation = (taskId: string, code: string) => ({ taskId, code, title: '원본', status: 'todo', assistant: { id: 'a', name: '도우미', color: '#000' },
  sharedTags: ['X'], messageCount: 2, bytes: 10, lastActivityAt: '2026-01-01' })
const after: Candidates = { files: [file('own', 't'), file('f1', 'a'), file('f2', 'a'), file('old', 'a', { newerVersionId: 'f2' })], conversations: [conversation('a', 'WK-1')] }

it('같은 태그 항목은 다른 대화의 최신 파일과 같은 태그 대화다 — 이 대화 파일·이전 버전은 빼다', () => {
  expect(sharedItems('t', after)).toEqual([
    { id: 'f1', kind: 'file', label: 'f1.txt' }, { id: 'f2', kind: 'file', label: 'f2.txt' }, { id: 'a', kind: 'conversation', label: 'WK-1' },
  ])
  const before = sharedItems('t', { files: [file('f1', 'a')], conversations: [] })
  expect(shareDiff(before, sharedItems('t', after))).toEqual({
    added: [{ id: 'f2', kind: 'file', label: 'f2.txt' }, { id: 'a', kind: 'conversation', label: 'WK-1' }], removed: [],
  })
})

it('태그를 넣으면 전후 자료함을 비교해 새 항목을 표시하고 도우미가 개수를 알린다 — 표시는 잠시 뒤 사라진다', async () => {
  vi.useFakeTimers()
  const responses: Candidates[] = [{ files: [], conversations: [] }, after]
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } })))
  const query = new QueryClient()
  const action = vi.fn(async () => {})
  await changeTagWithShare(query, 't', action)
  expect(action).toHaveBeenCalledOnce()
  expect(query.getQueryData(['candidates', 't'])).toEqual(after) // SSE 없이도 자료함이 새 태그 기준으로 바뀐다
  expect(useTagShareStore.getState().byTask.t).toMatchObject({ fresh: ['f1', 'f2', 'a'], gone: [] })
  expect(useBubbleStore.getState().current).toMatchObject({ source: 'share.in', key: 't', counts: { conversations: 1, files: 2 } })
  vi.advanceTimersByTime(FRESH_MS)
  expect(useTagShareStore.getState().byTask.t).toBeUndefined()
})

it('태그를 빼면 빠진 항목을 남기고 빠짐을 알린다. 아무것도 들어오지 않으면 그렇다고 알린다', async () => {
  const query = new QueryClient()
  query.setQueryData(['candidates', 't'], after) // 이미 본 자료함이 비교 기준
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ files: [file('own', 't')], conversations: [] }), { status: 200, headers: { 'content-type': 'application/json' } })))
  await changeTagWithShare(query, 't', async () => {})
  expect(useTagShareStore.getState().byTask.t?.gone.map((item) => item.id)).toEqual(['f1', 'f2', 'a'])
  expect(useBubbleStore.getState().current).toMatchObject({ source: 'share.out', counts: { conversations: 1, files: 2 } })
  useBubbleStore.getState().dismiss()
  await changeTagWithShare(query, 't', async () => {})
  expect(useBubbleStore.getState().current).toMatchObject({ source: 'share.none' })
})

it('태그 변경이 실패하면 표시·말풍선 없이 오류를 그대로 넘긴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ files: [], conversations: [] }), { status: 200, headers: { 'content-type': 'application/json' } })))
  await expect(changeTagWithShare(new QueryClient(), 't', async () => { throw new Error('거부') })).rejects.toThrow('거부')
  expect(useTagShareStore.getState().byTask.t).toBeUndefined()
  expect(useBubbleStore.getState().current).toBeNull()
})
