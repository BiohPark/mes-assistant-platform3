import { useQuery } from '@tanstack/react-query'
import { isSrTag, rankTagSuggestions, tagKey, type SrTagStatus, type TagSuggestion } from '@mes/domain'
import { suggestTags } from '@/api/tasks'

/** 후보 목록은 서버가 열람 범위를 적용해 돌려준다(보이는 대화의 태그 + 보이는 접수 SR 코드 + 그 범위 srScope) */
const suggestQuery = { queryKey: ['tag-suggest'], queryFn: () => suggestTags() }

export function useTagSuggest() {
  const { data } = useQuery(suggestQuery)
  return (prefix: string, exclude: string[]): TagSuggestion[] => {
    const excluded = new Set(exclude.map(tagKey))
    return rankTagSuggestions((data?.items ?? []).filter((item) => !excluded.has(tagKey(item.tag))), prefix)
  }
}

/**
 * SR 번호 태그의 접수 판정. 일반 태그는 null, 목록 로딩 전엔 undefined(표시 보류).
 * 목록에 없는 번호는 서버의 srScope에 따라 — 전체를 보면 '미접수', 일부만 보면 '확인 불가'(권한 밖 SR을 미접수로 단정하지 않음).
 */
export function useSrStatus() {
  const { data } = useQuery(suggestQuery)
  return (tag: string): SrTagStatus | null | undefined => {
    if (!isSrTag(tag)) return null
    if (!data) return undefined
    return data.items.find((item) => tagKey(item.tag) === tagKey(tag))?.srStatus ?? (data.srScope === 'all' ? 'unfiled' : 'unknown')
  }
}
