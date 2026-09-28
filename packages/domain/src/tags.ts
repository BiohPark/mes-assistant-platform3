import type { Assistant, FileAsset, ID, Task, TaskInput } from './types.js'

const SR_TAG = /^SR-\d{4}-\d{4}$/i

/** 태그 표기 정규화: 앞뒤 공백·`#` 제거, 공백→하이픈. SR 코드는 대문자로. */
export function normalizeTag(raw: string): string {
  const t = raw.trim().replace(/^#+/, '').trim().replace(/\s+/g, '-')
  if (!t) return ''
  return SR_TAG.test(t) ? t.toUpperCase() : t
}

/** 중복 판단용 키 (대소문자 무시) */
export function tagKey(tag: string): string {
  return normalizeTag(tag).toLowerCase()
}

export function isSrTag(tag: string): boolean {
  return SR_TAG.test(tag)
}

/** SR 태그 색: 코드 해시로 고른 저채도 색. 일반 태그는 중립색(undefined). */
export function srTagColor(tag: string): string | undefined {
  if (!isSrTag(tag)) return undefined
  let h = 0
  for (const ch of tag.toUpperCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 35% 45%)`
}

/** 카드 표시선에 쓰는 SR: 처음 연결한(목록상 첫) SR 태그 */
export function primarySrTag(tags: string[]): string | undefined {
  return tags.find(isSrTag)
}

export interface TagSuggestion {
  tag: string
  count: number
  isSr: boolean
}

/** 자동완성 후보: 사용 빈도순 + 접수된 SR 코드. 이미 붙은 태그는 제외. */
export function tagSuggestions(tasks: Task[], srCodes: string[], prefix: string, exclude: string[] = []): TagSuggestion[] {
  const excluded = new Set(exclude.map(tagKey))
  const byKey = new Map<string, TagSuggestion>()
  const add = (tag: string, n: number) => {
    const key = tagKey(tag)
    if (!key || excluded.has(key)) return
    const cur = byKey.get(key)
    byKey.set(key, { tag: cur?.tag ?? normalizeTag(tag), count: (cur?.count ?? 0) + n, isSr: isSrTag(tag) })
  }
  for (const t of tasks) for (const tag of t.tags) add(tag, 1)
  for (const code of srCodes) if (code) add(code, 0)
  const p = tagKey(prefix)
  return [...byKey.values()].filter((s) => !p || tagKey(s.tag).startsWith(p) || tagKey(s.tag).includes(p)).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export type PoolRole = 'output' | 'upload'

export interface PoolItem {
  file: FileAsset
  sourceTask: Task
  /** 이 파일을 찾게 해 준 공통 태그 */
  viaTags: string[]
  role: PoolRole
  /** 현재 대화에서 선택된 입력 등급 */
  selected?: TaskInput['weight']
  /** 선택한 버전보다 새 버전이 있으면 그 ID */
  newerVersionId?: ID
  /** 최신 버전 항목일 때 접힌 이전 버전들 */
  olderVersionIds?: ID[]
}

export interface PoolGroup {
  assistant: Assistant
  items: PoolItem[]
}

export interface SharedPool {
  /** 출처 에이전트(갤러리 순) 그룹 */
  groups: PoolGroup[]
  /** 이 대화에서 만든 파일 */
  own: Array<{ file: FileAsset; role: PoolRole; selected?: TaskInput['weight'] }>
  /** 태그가 해제됐어도 이미 선택해 둔 입력 (선택은 유지) */
  detachedInputs: Array<{ file: FileAsset; weight: TaskInput['weight'] }>
}

/** 버전 체인의 최신 파일 ID를 찾기 위한 역방향 맵 (previousId → 다음 버전) */
function latestOf(fileId: ID, nextOf: Map<ID, ID>): ID {
  let cur = fileId
  const seen = new Set<ID>()
  while (nextOf.has(cur) && !seen.has(cur)) {
    seen.add(cur)
    cur = nextOf.get(cur)!
  }
  return cur
}

/**
 * 공유 자료함. 현재 대화와 **직접** 공유하는 태그가 하나라도 있는 대화의 파일만 보여준다(간접 확산 없음).
 * 같은 파일은 한 번만, 버전 체인은 최신만 펼치되 선택된 이전 버전은 따로 보인다.
 * 보이는 것만으로는 AI에 전달되지 않는다 — 선택(task.inputs)만 프롬프트에 들어간다.
 */
export function sharedPool(me: Task, tasks: Task[], files: FileAsset[], assistants: Assistant[]): SharedPool {
  const myTags = new Set(me.tags.map(tagKey))
  const selected = new Map(me.inputs.map((i) => [i.fileId, i.weight]))
  const fileById = new Map(files.map((f) => [f.id, f]))
  const nextOf = new Map<ID, ID>()
  for (const f of files) if (f.previousId) nextOf.set(f.previousId, f.id)
  const asstOrder = new Map(assistants.map((a) => [a.id, a]))
  const roleOf = (t: Task, f: FileAsset): PoolRole => (t.outputFileIds.includes(f.id) || f.source === 'assistant' ? 'output' : 'upload')

  const itemsByAssistant = new Map<ID, PoolItem[]>()
  const shownFileIds = new Set<ID>()
  for (const t of tasks) {
    if (t.id === me.id) continue
    const via = t.tags.filter((tag) => myTags.has(tagKey(tag)))
    if (via.length === 0) continue
    const theirs = files.filter((f) => f.originTaskId === t.id && !f.tags.includes('assistant-image'))
    const chainHeads = new Set(theirs.map((f) => latestOf(f.id, nextOf)))
    for (const f of theirs) {
      const isLatest = chainHeads.has(f.id)
      const isSelected = selected.has(f.id)
      if (!isLatest && !isSelected) continue
      if (shownFileIds.has(f.id)) continue
      shownFileIds.add(f.id)
      const latest = latestOf(f.id, nextOf)
      const older: ID[] = []
      if (isLatest) {
        let cur = f.previousId
        while (cur && fileById.has(cur)) {
          older.push(cur)
          cur = fileById.get(cur)!.previousId
        }
      }
      const item: PoolItem = {
        file: f,
        sourceTask: t,
        viaTags: via,
        role: roleOf(t, f),
        selected: selected.get(f.id),
        newerVersionId: isSelected && latest !== f.id ? latest : undefined,
        olderVersionIds: older.length ? older : undefined,
      }
      itemsByAssistant.set(t.assistantId, [...(itemsByAssistant.get(t.assistantId) ?? []), item])
    }
  }

  const groups = [...itemsByAssistant.entries()]
    .map(([aid, items]) => ({
      assistant: asstOrder.get(aid) ?? ({ id: aid, name: aid, order: Number.MAX_SAFE_INTEGER } as Assistant),
      // 선택된 이전 버전을 최신 버전 앞에 두어 비교가 쉽게
      items: [...items].sort((a, b) => a.file.name.localeCompare(b.file.name) || a.file.version - b.file.version),
    }))
    .sort((a, b) => a.assistant.order - b.assistant.order)

  const own = files.filter((f) => f.originTaskId === me.id).map((f) => ({ file: f, role: roleOf(me, f), selected: selected.get(f.id) }))
  const ownIds = new Set(own.map((o) => o.file.id))
  const detachedInputs = me.inputs
    .filter((i) => !shownFileIds.has(i.fileId) && !ownIds.has(i.fileId))
    .flatMap((i) => {
      const f = fileById.get(i.fileId)
      return f ? [{ file: f, weight: i.weight }] : []
    })

  return { groups, own, detachedInputs }
}
