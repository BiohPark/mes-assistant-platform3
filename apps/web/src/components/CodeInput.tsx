import { useCallback, useMemo } from 'react'
import type { Assistant, CatalogCode } from '@mes/contracts'
import { useT } from '@/i18n'
import { SuggestInput, type Option } from './SuggestInput'

const normalize = (value: string) => value.trim().replace(/\s+/gu, ' ').normalize('NFC')
const key = (value: string) => normalize(value).toLowerCase()

interface CodeInputProps {
  group: 'assistant_level1' | 'assistant_level2'
  codes: CatalogCode[]
  assistants: Assistant[]
  level1?: string
  value: string
  onChange: (value: string) => void
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-label': string
  disabled?: boolean
}

export function CodeInput({ group, codes, assistants, level1 = '', value, onChange, ...props }: CodeInputProps) {
  const t = useT()
  const options = useMemo(() => codes.filter(item => item.groupKey === group && item.active).map(item => {
    const used = assistants.filter(row => (row.classifications ?? [row]).some(path => (group === 'assistant_level1' ? path.level1CodeId : path.level2CodeId) === item.id))
    const together = group === 'assistant_level2' && level1 ? used.filter(row => (row.classifications ?? [row]).some(path => path.level2CodeId === item.id && key(path.level1) === key(level1))).length : 0
    return { item, count: used.length, together }
  }).sort((a, b) => b.together - a.together || b.count - a.count || a.item.sortOrder - b.item.sortOrder || a.item.id.localeCompare(b.item.id))
    .map(({ item, count }): Option => ({ value: normalize(item.name), label: normalize(item.name), hint: t('admin.codeUsage', { count }) })), [group, codes, assistants, level1, t])
  const source = useCallback(() => options, [options])
  return <SuggestInput mode="single" value={value ? { value, label: value } : null}
    onChange={option => onChange(option ? normalize(option.label) : '')} source={source} allowCreate
    normalizeValue={normalize} quickPicks={options} {...props} />
}
