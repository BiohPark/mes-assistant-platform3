import { tagKey } from './tags.js'
import { TASK_STATUSES, type Assistant, type ID, type Task, type TaskStatus } from './types.js'

/** 업무 단계 = 에이전트 Lv1/Lv2. 하드코딩한 단계 목록 대신 카탈로그에서 뽑는다. */
export function stageKey(a: Pick<Assistant, 'level1' | 'level2'>): string {
  return `${a.level1}/${a.level2}`
}

export interface StageGroup {
  level1: string
  stages: Array<{ key: string; level2: string }>
}

/** 단계 필터 칩: 공통 순서(order)에서 처음 나오는 순서대로 Lv1 → Lv2 */
export function stageOptions(assistants: Assistant[]): StageGroup[] {
  const groups: StageGroup[] = []
  for (const a of [...assistants].sort((x, y) => x.order - y.order)) {
    let g = groups.find((x) => x.level1 === a.level1)
    if (!g) {
      g = { level1: a.level1, stages: [] }
      groups.push(g)
    }
    const key = stageKey(a)
    if (!g.stages.some((s) => s.key === key)) g.stages.push({ key, level2: a.level2 })
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
export function filterFromParams(p: URLSearchParams): KanbanFilter {
  return {
    stages: p.getAll('stage'),
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
  const byAssistant = new Map<ID, Task[]>()
  for (const t of tasks) {
    if (!matchesTask(t, f, userId)) continue
    byAssistant.set(t.assistantId, [...(byAssistant.get(t.assistantId) ?? []), t])
  }
  const hasAny = new Set(tasks.map((t) => t.assistantId))
  return [...assistants]
    .sort((a, b) => a.order - b.order)
    .filter((a) => (f.stages.length ? f.stages.includes(stageKey(a)) : true))
    .filter((a) => (f.assistantId ? a.id === f.assistantId : true))
    .filter((a) => a.status !== 'retired' || hasAny.has(a.id))
    .map((assistant) => ({
      assistant,
      tasks: (byAssistant.get(assistant.id) ?? []).sort((x, y) => y.lastActivityAt.localeCompare(x.lastActivityAt)),
    }))
}
