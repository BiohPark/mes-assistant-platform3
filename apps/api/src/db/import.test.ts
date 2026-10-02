import { describe, expect, it } from 'vitest'
import { DEFAULT_IMPORT_BUNDLE_MAX_BYTES, loginIdFor, normalizeBundle, parseBundleJson, validateBundle } from './import.js'

const at = '2026-09-01T00:00:00.000Z'
const empty = { format: 'mes-assistant-hub', version: 3, exportedAt: at, tables: {} }

describe('demo bundle import rules', () => {
  it('defaults to a 64 MiB bundle limit', () => {
    expect(DEFAULT_IMPORT_BUNDLE_MAX_BYTES).toBe(64 * 1024 ** 2)
  })
  it('accepts only demo format and versions 1–3 with array tables', () => {
    expect(validateBundle(empty)).toBe(true)
    expect(validateBundle({ ...empty, version: 4 })).toBe(false)
    expect(validateBundle({ ...empty, format: 'other' })).toBe(false)
    expect(validateBundle({ ...empty, tables: { users: {} } })).toBe(false)
  })

  it('imports v1 package tasks as one task per thread with SR tags and reference inputs', () => {
    const bundle = normalizeBundle({ ...empty, version: 1, tables: {
      tasks: [{ id: 'task-a', code: 'WK-2099-0001', title: 'Draft', tags: ['alpha'], inputFileIds: ['file-a'], srIds: ['sr-a'], activeThreadId: 'thread-a', createdAt: at, createdBy: 'user-a',
        checklist: [{ id: 'check-a', label: 'Check' }], checklistReview: { by: 'user-a', at, met: 1, total: 1, source: 'rule', items: [{ itemId: 'check-a', met: true }] } }],
      threads: [{ id: 'thread-a', taskId: 'task-a', title: 'One', createdAt: at }, { id: 'thread-b', taskId: 'task-a', title: 'Two', createdAt: '2026-09-02T00:00:00.000Z' }],
      assistants: [{ id: 'urs-analyst', status: 'working' }, { id: 'assistant-a', status: 'working' }],
      serviceRequests: [{ id: 'sr-a', code: 'SR-2099-0001', title: 'Request' }],
      packages: [{ id: 'package-a' }],
    } })
    expect(bundle.tables.tasks).toMatchObject([
      { id: 'task-a', threadId: 'thread-a', titleSource: 'manual', tags: ['alpha', 'SR-2099-0001'], inputs: [{ fileId: 'file-a', weight: 'reference' }] },
      { id: 'task-a_split1', code: 'WK-2099-0001-2', threadId: 'thread-b', inputs: [], outputFileIds: [], checklist: [{ id: 'task-a_split1:check-a' }],
        checklistReview: { items: [{ itemId: 'task-a_split1:check-a' }] } },
    ])
    expect(bundle.tables.threads?.[1]).toMatchObject({ taskId: 'task-a_split1' })
    expect(bundle.tables.serviceRequests?.[0]).toMatchObject({ titleSource: 'manual' })
    expect(bundle.tables.assistants).toHaveLength(13)
    expect(bundle.tables.assistants?.[0]).toMatchObject({ id: 'deviation-drafter', order: 1 })
    expect(bundle.tables.assistants?.find((a) => a.id === 'urs-analyst')).toMatchObject({ status: 'developing', order: 6, expectedInputs: [], expectedOutputs: [] })
    expect(bundle.tables.assistants?.at(-1)).toMatchObject({ id: 'assistant-a', status: 'developing', level1: '이전 데모', order: 1000, expectedInputs: [], expectedOutputs: [] })
    expect(bundle.tables.packages).toHaveLength(1)
  })

  it('generates valid deterministic login IDs and suffixes collisions', () => {
    const used = new Set(['demo-user-a'])
    expect(loginIdFor('user-a', 'User A', used)).toBe('demo-user-a-2')
    expect(loginIdFor('한글', '가상 사용자', used)).toMatch(/^demo-[a-z0-9-]{3,}$/)
  })

  it('does not expose malformed JSON input in a parse error', () => {
    const secret = 'private-bundle-token'
    let message = ''
    try { parseBundleJson(Buffer.from(`{"secret": ${secret}}`)) }
    catch (error) { message = (error as Error).message }
    expect(message).toBe('유효하지 않은 JSON 파일입니다.')
    expect(message).not.toContain(secret)
  })
})
