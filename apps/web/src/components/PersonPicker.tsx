import { useT } from '@/i18n'
import { SuggestInput, type Option, type SuggestInputProps } from './SuggestInput'

export type PersonPickerProps = (
  | Omit<Extract<SuggestInputProps, { mode: 'single' }>, 'allowCreate' | 'quickPicks'>
  | Omit<Extract<SuggestInputProps, { mode: 'multi' }>, 'allowCreate' | 'quickPicks'>
) & { me?: Option; recent?: Option[] }

export function PersonPicker({ me, recent = [], ...props }: PersonPickerProps) {
  const t = useT()
  const originals = [...(me ? [me] : []), ...recent]
  const quickPicks: Option[] = originals.map((person, i) => ({ ...person, hint: t(me && i === 0 ? 'components.me' : 'components.recent') }))
  const original = (option: Option) => originals[quickPicks.indexOf(option)] ?? option
  const defaults = { placeholder: t('components.personPlaceholder'), 'aria-label': t('components.personLabel'), invalidMessage: t('components.personInvalid') }
  return props.mode === 'single'
    ? <SuggestInput {...defaults} {...props} onChange={(value: Option | null) => props.onChange(value ? original(value) : null)} allowCreate={false} quickPicks={quickPicks} />
    : <SuggestInput {...defaults} {...props} onChange={(value: Option[]) => props.onChange(value.map(original))} allowCreate={false} quickPicks={quickPicks} />
}
