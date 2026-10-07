import { useCallback } from 'react'
import type { AssistantStatus } from '@mes/domain'
import { useT } from '@/i18n'
import { SuggestInput, type Option, type SuggestInputProps } from './SuggestInput'

export interface AssistantOption extends Option { status: AssistantStatus }
export type AssistantPickerProps = (
  | Omit<Extract<SuggestInputProps, { mode: 'single' }>, 'allowCreate' | 'source' | 'quickPicks'>
  | Omit<Extract<SuggestInputProps, { mode: 'multi' }>, 'allowCreate' | 'source' | 'quickPicks'>
) & { source: (query: string) => AssistantOption[] | Promise<AssistantOption[]>; quickPicks?: AssistantOption[] }

export function AssistantPicker({ source, quickPicks = [], ...props }: AssistantPickerProps) {
  const t = useT()
  const activeSource = useCallback((query: string) => {
    const result = source(query)
    return Array.isArray(result) ? result.filter(option => option.status !== 'retired') : result.then(options => options.filter(option => option.status !== 'retired'))
  }, [source])
  return <SuggestInput placeholder={t('components.assistantPlaceholder')} aria-label={t('components.assistantLabel')} invalidMessage={t('components.assistantInvalid')} {...props} source={activeSource} quickPicks={quickPicks.filter(option => option.status !== 'retired')} allowCreate={false} />
}
