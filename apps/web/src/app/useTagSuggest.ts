import { useQuery } from '@tanstack/react-query'
import { normalizeTag, tagKey, type TagSuggestion } from '@mes/domain'
import { suggestTags } from '@/api/tasks'

export function useTagSuggest() {
  const { data = [] } = useQuery({ queryKey: ['tag-suggest'], queryFn: () => suggestTags() })
  return (prefix: string, exclude: string[]): TagSuggestion[] => {
    const excluded = new Set(exclude.map(tagKey))
    const search = tagKey(normalizeTag(prefix))
    return data.filter((item) => !excluded.has(tagKey(item.tag)) && (!search || tagKey(item.tag).includes(search)))
  }
}
