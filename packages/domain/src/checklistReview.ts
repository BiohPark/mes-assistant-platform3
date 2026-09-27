import type { ChecklistItem, ChecklistReview, ChecklistReviewItem, ID, ISODate } from './types.js'

interface ReviewMeta {
  by: ID
  at: ISODate
}

/** 규칙 판단에서 "관련 내용 있음"으로 볼 최소 단어 일치 비율 */
const RULE_MATCH_RATIO = 0.5
const MIN_WORD_LENGTH = 2

/**
 * 달성도 점검용 system 프롬프트. 흐름을 지시하지 않고 판정만 요청한다.
 * 체크리스트는 강제 사항이 아니며 결과는 참고 점수다.
 */
export function checklistReviewPrompt(checklist: ChecklistItem[]): string {
  const list = checklist.map((c, i) => `${i + 1}. ${c.label}`).join('\n')
  return [
    '아래 체크리스트 항목이 이어지는 대화에서 달성되었는지 판정하라.',
    '대화에 근거가 있을 때만 met=true로 하고, note에 근거를 한 줄로 적는다.',
    '반드시 JSON만 출력한다: {"items":[{"no":1,"met":true,"note":"…"}]}',
    '',
    '## 체크리스트',
    list,
  ].join('\n')
}

function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1]
  const obj = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  const arr = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)
  // 먼저 나온 괄호가 바깥 구조다 (배열 안의 객체를 통째로 잘못 잡지 않도록)
  const arrayFirst = raw.indexOf('[') !== -1 && (raw.indexOf('{') === -1 || raw.indexOf('[') < raw.indexOf('{'))
  const candidates = [fenced, ...(arrayFirst ? [arr, obj] : [obj, arr])]
  for (const c of candidates) {
    if (!c?.trim()) continue
    try {
      return JSON.parse(c)
    } catch {
      // 다음 후보
    }
  }
  return undefined
}

function toReview(checklist: ChecklistItem[], judged: Map<number, { met: boolean; note: string }>, meta: ReviewMeta, source: ChecklistReview['source']): ChecklistReview {
  const items: ChecklistReviewItem[] = checklist.map((c, i) => {
    const j = judged.get(i + 1)
    return { itemId: c.id, met: j?.met ?? false, note: j?.note ?? '' }
  })
  return { ...meta, met: items.filter((i) => i.met).length, total: items.length, items, source }
}

/** 모델 응답(JSON, 코드펜스 허용)을 점검 결과로. 파싱 실패 시 undefined */
export function parseChecklistReview(raw: string, checklist: ChecklistItem[], meta: ReviewMeta): ChecklistReview | undefined {
  const parsed = extractJson(raw)
  const list = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown } | undefined)?.items
  if (!Array.isArray(list)) return undefined
  const judged = new Map<number, { met: boolean; note: string }>()
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { no?: unknown; met?: unknown; note?: unknown }
    const no = Number(e.no)
    if (!Number.isInteger(no) || no < 1 || no > checklist.length) continue
    judged.set(no, { met: e.met === true, note: typeof e.note === 'string' ? e.note.slice(0, 200) : '' })
  }
  return toReview(checklist, judged, meta, 'ai')
}

/** Mock/실패 시 규칙 판단: 사용자가 체크했거나, 항목 단어의 절반 이상이 assistant 답변에 나오면 달성 */
export function ruleChecklistReview(checklist: ChecklistItem[], assistantReplies: string[], meta: ReviewMeta): ChecklistReview {
  const text = assistantReplies.join('\n').toLowerCase()
  const judged = new Map<number, { met: boolean; note: string }>()
  checklist.forEach((c, i) => {
    if (c.checked) {
      judged.set(i + 1, { met: true, note: '사용자가 체크함' })
      return
    }
    const words = c.label
      .toLowerCase()
      .split(/[\s·,/()]+/)
      .filter((w) => w.length >= MIN_WORD_LENGTH)
    const hits = words.filter((w) => text.includes(w)).length
    const met = words.length > 0 && hits / words.length >= RULE_MATCH_RATIO
    judged.set(i + 1, { met, note: met ? '대화에 관련 내용이 있음' : '대화에서 근거를 찾지 못함' })
  })
  return toReview(checklist, judged, meta, 'rule')
}
