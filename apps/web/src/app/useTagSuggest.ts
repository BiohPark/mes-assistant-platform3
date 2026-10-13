import { useQuery } from '@tanstack/react-query'
import { isSrTag, rankTagSuggestions, tagKey, type TagSuggestion } from '@mes/domain'
import { suggestTags } from '@/api/tasks'

/** 후보 목록은 서버가 열람 범위를 적용해 돌려준다(보이는 대화의 태그 + 보이는 접수 SR 코드) */
const suggestQuery = { queryKey: ['tag-suggest'], queryFn: () => suggestTags() }

export function useTagSuggest() {
  const { data = [] } = useQuery(suggestQuery)
  return (prefix: string, exclude: string[]): TagSuggestion[] => {
    const excluded = new Set(exclude.map(tagKey))
    return rankTagSuggestions(data.filter((item) => !excluded.has(tagKey(item.tag))), prefix)
  }
}

/** SR 번호 태그에 접수된 SR이 있는지. 일반 태그는 항상 true, 목록 로딩 전엔 undefined(표시 보류) */
export function useSrAccepted() {
  const { data } = useQuery(suggestQuery)
  return (tag: string): boolean | undefined => {
    if (!isSrTag(tag)) return true
    if (!data) return undefined
    return data.some((item) => item.srAccepted && tagKey(item.tag) === tagKey(tag))
  }
}
