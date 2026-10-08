import { tagKey } from './tags.js'
import { TASK_STATUSES, type Assistant, type ID, type Task, type TaskStatus } from './types.js'

/** 업무 단계 = 에이전트 Lv1/Lv2. 하드코딩한 단계 목록 대신 카탈로그에서 뽑는다. */
export function stageKey(a: Pick<Assistant, 'level1' | 'level2' | 'level1CodeId' | 'level2CodeId'>): string {
  if (!a.level1CodeId && !a.level2CodeId) return `${a.level1}/${a.level2}`
  return `${encodeURIComponent(a.level1CodeId ?? a.level1)}/${encodeURIComponent(a.level2CodeId ?? a.level2)}`
}

/** 구형 이름 키는 카탈로그의 유일한 코드 쌍에만 대응한다. 같은 쌍을 공유하는 에이전트는 중복이 아니다. */
export function resolveStageKey(key: string, assistants: Assistant[]): string | undefined {
  const matches = new Set<string>()
  for (const assistant of assistants) {
    for (const path of assistant.classifications ?? [assistant]) {
      const canonical = stageKey(path)
      if (canonical === key) return key
      if (`${path.level1}/${path.level2}` === key) matches.add(canonical)
    }
  }
  return matches.size === 1 ? [...matches][0] : undefined
}

export interface StageGroup {
  level1: string
  stages: Array<{ key: string; level2: string }>
}

/** 단계 필터 칩: 공통 순서(order)에서 처음 나오는 순서대로 Lv1 → Lv2 */
export function stageOptions(assistants: Assistant[]): StageGroup[] {
  const groups: StageGroup[] = []
  for (const a of [...assistants].sort((x, y) => x.order - y.order)) {
    for (const path of a.classifications ?? [a]) {
      let g = groups.find((x) => x.level1 === path.level1)
      if (!g) { g = { level1: path.level1, stages: [] }; groups.push(g) }
      const key = stageKey(path)
      if (!g.stages.some((s) => s.key === key)) g.stages.push({ key, level2: path.level2 })
    }
  }
  return groups
}

export interface KanbanFilter {
  stages: string[]
  statuses: TaskStatus[]
  tags: string[]
  /** 내가 소유자이거나 참여자인 대화만 */
  mine: boolean
  assistantId?: ID
  q: string
}

export const EMPTY_FILTER: KanbanFilter = { stages: [], statuses: [], tags: [], mine: false, q: '' }

export function isFiltering(f: KanbanFilter): boolean {
  return f.stages.length > 0 || f.statuses.length > 0 || f.tags.length > 0 || f.mine || !!f.assistantId || !!f.q.trim()
}

/** URL ↔ 필터. `/?view=kanban&tag=SR-2026-0002&status=in_progress` 처럼 북마크·공유할 수 있다. */
export function filterFromParams(p: URLSearchParams, assistants?: Assistant[]): KanbanFilter {
  return {
    stages: assistants === undefined ? p.getAll('stage') : p.getAll('stage').flatMap(key => {
      const resolved = resolveStageKey(key, assistants)
      return resolved === undefined ? [] : [resolved]
    }),
    statuses: p.getAll('status').filter((s): s is TaskStatus => (TASK_STATUSES as string[]).includes(s)),
    tags: p.getAll('tag'),
    mine: p.get('mine') === '1',
    assistantId: p.get('assistant') ?? undefined,
    q: p.get('q') ?? '',
  }
}

export function filterToParams(f: KanbanFilter, base: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base)
  for (const k of ['stage', 'status', 'tag', 'mine', 'assistant', 'q']) next.delete(k)
  f.stages.forEach((s) => next.append('stage', s))
  f.statuses.forEach((s) => next.append('status', s))
  f.tags.forEach((t) => next.append('tag', t))
  if (f.mine) next.set('mine', '1')
  if (f.assistantId) next.set('assistant', f.assistantId)
  if (f.q.trim()) next.set('q', f.q.trim())
  return next
}

export interface KanbanColumn {
  assistant: Assistant
  tasks: Task[]
}

function matchesTask(t: Task, f: KanbanFilter, userId?: ID): boolean {
  if (f.statuses.length && !f.statuses.includes(t.status)) return false
  if (f.tags.length) {
    const mine = new Set(t.tags.map(tagKey))
    if (!f.tags.some((x) => mine.has(tagKey(x)))) return false
  }
  if (f.mine && userId && t.ownerId !== userId && !t.assigneeIds.includes(userId)) return false
  const q = f.q.trim().toLowerCase()
  if (q && !`${t.code} ${t.title} ${t.summary} ${t.tags.join(' ')}`.toLowerCase().includes(q)) return false
  return true
}

/**
 * 칸반 열 = 에이전트(카드 갤러리와 같은 order), 카드 = 대화(최근 활동순).
 * 폐기된 에이전트 열은 대화가 남아 있을 때만 보인다.
 */
export function kanbanColumns(assistants: Assistant[], tasks: Task[], f: KanbanFilter, userId?: ID): KanbanColumn[] {
  const stages = f.stages.map(key => resolveStageKey(key, assistants) ?? key)
  const byAssistant = new Map<ID, Task[]>()
  for (const t of tasks) {
    if (!matchesTask(t, f, userId)) continue
    byAssistant.set(t.assistantId, [...(byAssistant.get(t.assistantId) ?? []), t])
  }
  const hasAny = new Set(tasks.map((t) => t.assistantId))
  return [...assistants]
    .sort((a, b) => a.order - b.order)
    .filter((a) => (stages.length ? (a.classifications ?? [a]).some(path => stages.includes(stageKey(path))) : true))
    .filter((a) => (f.assistantId ? a.id === f.assistantId : true))
    .filter((a) => a.status !== 'retired' || hasAny.has(a.id))
    .map((assistant) => ({
      assistant,
      tasks: (byAssistant.get(assistant.id) ?? []).sort((x, y) => y.lastActivityAt.localeCompare(x.lastActivityAt)),
    }))
}
