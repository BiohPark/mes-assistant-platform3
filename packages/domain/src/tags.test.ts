import { describe, it, expect } from 'vitest'
import { isSrTag, normalizeTag, sharedPool, srTagColor, tagKey, tagSuggestions, primarySrTag } from './tags.js'
import type { Assistant, FileAsset, Task } from './types.js'

const file = (id: string, originTaskId: string, extra: Partial<FileAsset> = {}): FileAsset => ({
  id,
  originTaskId,
  name: `${id}.md`,
  mime: 'text/markdown',
  size: 1,
  blob: new Blob(['x']),
  uploadedBy: 'u1',
  uploadedAt: '2026-01-01T00:00:00.000Z',
  source: 'assistant',
  tags: [],
  version: 1,
  ...extra,
})
const task = (id: string, assistantId: string, tags: string[], extra: Partial<Task> = {}): Task => ({
  id,
  code: id,
  assistantId,
  title: id,
  titleSource: 'default',
  summary: '',
  status: 'in_progress',
  ownerId: 'u1',
  assigneeIds: [],
  priority: 'normal',
  tags,
  checklist: [],
  inputs: [],
  outputFileIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})
const asst = (id: string, order: number) => ({ id, order, name: id, level2: `L-${id}` }) as Assistant

describe('normalizeTag', () => {
  it('trims, removes #, turns spaces into hyphens', () => {
    expect(normalizeTag('  #change control  item ')).toBe('change-control-item')
  })
  it('upper-cases SR codes', () => {
    expect(normalizeTag('sr-2026-0002')).toBe('SR-2026-0002')
  })
  it('returns empty for blank', () => {
    expect(normalizeTag('  # ')).toBe('')
  })
  it('tagKey compares case-insensitively', () => {
    expect(tagKey('CCA-Item')).toBe(tagKey('cca-item'))
  })
})

describe('isSrTag / srTagColor / primarySrTag', () => {
  it('detects SR code pattern only', () => {
    expect(isSrTag('SR-2026-0002')).toBe(true)
    expect(isSrTag('SR-2026')).toBe(false)
    expect(isSrTag('CCA-2026-0001')).toBe(false)
  })
  it('color is deterministic and low saturation; undefined for non-SR', () => {
    expect(srTagColor('SR-2026-0002')).toBe(srTagColor('SR-2026-0002'))
    expect(srTagColor('SR-2026-0002')).toMatch(/^hsl\(\d+ 3\d% /)
    expect(srTagColor('cca')).toBeUndefined()
  })
  it('primary SR tag is the first SR tag in order of addition', () => {
    expect(primarySrTag(['cca', 'SR-2026-0003', 'SR-2026-0001'])).toBe('SR-2026-0003')
    expect(primarySrTag(['cca'])).toBeUndefined()
  })
})

describe('tagSuggestions', () => {
  it('ranks by usage count and filters by prefix; includes SR codes', () => {
    const tasks = [task('a', 'x', ['cca', 'SR-2026-0001']), task('b', 'x', ['cca']), task('c', 'x', ['cc-item'])]
    const out = tagSuggestions(tasks, ['SR-2026-0009'], 'c')
    expect(out.map((s) => s.tag)).toEqual(['cca', 'cc-item'])
    expect(out[0].count).toBe(2)
    expect(tagSuggestions(tasks, ['SR-2026-0009'], 'sr').map((s) => s.tag)).toEqual(['SR-2026-0001', 'SR-2026-0009'])
  })
  it('excludes tags already on the conversation', () => {
    const tasks = [task('a', 'x', ['cca'])]
    expect(tagSuggestions(tasks, [], '', ['CCA'])).toEqual([])
  })
})

describe('sharedPool', () => {
  const assistants = [asst('urs', 1), asst('fds', 2), asst('test', 3)]

  it('shows files of directly tag-sharing conversations once, grouped by source assistant order', () => {
    const urs = task('urs1', 'urs', ['SR-1', 'cca'], { outputFileIds: ['f1'] })
    const fds = task('fds1', 'fds', ['SR-1', 'cca'])
    const files = [file('f1', 'urs1'), file('own', 'fds1')]
    const pool = sharedPool(fds, [urs, fds], files, assistants)
    expect(pool.groups.map((g) => g.assistant.id)).toEqual(['urs'])
    const item = pool.groups[0].items[0]
    expect(item.file.id).toBe('f1')
    expect(item.viaTags).toEqual(['SR-1', 'cca'])
    expect(item.role).toBe('output')
    expect(item.selected).toBeUndefined()
    // 내 대화 파일은 공유 자료함이 아니라 own
    expect(pool.own.map((f) => f.file.id)).toEqual(['own'])
  })

  it('does not propagate indirectly (A–B share t1, B–C share t2 → A sees nothing from C)', () => {
    const a = task('a', 'urs', ['t1'])
    const b = task('b', 'fds', ['t1', 't2'], { outputFileIds: ['fb'] })
    const c = task('c', 'test', ['t2'], { outputFileIds: ['fc'] })
    const files = [file('fb', 'b'), file('fc', 'c')]
    const pool = sharedPool(a, [a, b, c], files, assistants)
    const ids = pool.groups.flatMap((g) => g.items.map((i) => i.file.id))
    expect(ids).toEqual(['fb'])
  })

  it('shows only latest version per chain, but keeps a selected older version visible and flags newer', () => {
    const urs = task('urs1', 'urs', ['SR-1'], { outputFileIds: ['v2'] })
    const v1 = file('v1', 'urs1', { name: 'URS.md', version: 1 })
    const v2 = file('v2', 'urs1', { name: 'URS.md', version: 2, previousId: 'v1' })
    const fds = task('fds1', 'fds', ['SR-1'], { inputs: [{ fileId: 'v1', weight: 'main', selectedAt: '', selectedBy: 'u1' }] })
    const pool = sharedPool(fds, [urs, fds], [v1, v2], assistants)
    const items = pool.groups[0].items
    expect(items.map((i) => i.file.id)).toEqual(['v1', 'v2'])
    expect(items[0]).toMatchObject({ selected: 'main', newerVersionId: 'v2' })
    expect(items[1].olderVersionIds).toEqual(['v1'])
  })

  it('keeps selected inputs even after the shared tag is removed (as detached)', () => {
    const urs = task('urs1', 'urs', ['SR-1'], { outputFileIds: ['f1'] })
    const fds = task('fds1', 'fds', [], { inputs: [{ fileId: 'f1', weight: 'reference', selectedAt: '', selectedBy: 'u1' }] })
    const pool = sharedPool(fds, [urs, fds], [file('f1', 'urs1')], assistants)
    expect(pool.groups).toEqual([])
    expect(pool.detachedInputs.map((i) => i.file.id)).toEqual(['f1'])
  })

  it('ignores assistant images and files of conversations with no common tag', () => {
    const other = task('o', 'urs', ['x'], { outputFileIds: ['fo'] })
    const me = task('m', 'fds', ['y'])
    const pool = sharedPool(me, [other, me], [file('fo', 'o')], assistants)
    expect(pool.groups).toEqual([])
  })
})
