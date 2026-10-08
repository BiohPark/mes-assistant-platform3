import { Star } from 'lucide-react'
import type { TaskInput } from '@mes/domain'
import { Checkbox } from '@/components/ui/checkbox'
import { useT } from '@/i18n'

type Weight = TaskInput['weight']
export function InputToggle({ weight, onChange, disabled, label }: { weight?: Weight; onChange: (value: Weight | null) => void; disabled?: boolean; label: string }) {
  const t = useT()
  return <span className="inline-flex items-center gap-1">
    <button type="button" disabled={disabled} aria-label={t('task.inputs.setMain', { label })} aria-pressed={weight === 'main'} onClick={() => onChange(weight === 'main' ? 'reference' : 'main')} className="rounded-lg p-0.5 text-amber-500 disabled:opacity-40"><Star className={`size-3.5 ${weight === 'main' ? 'fill-amber-400' : ''}`} /></button>
    <Checkbox disabled={disabled} aria-label={weight ? t('task.inputs.remove', { label }) : t('task.inputs.selectReference', { label })} checked={!!weight} onCheckedChange={(checked) => onChange(checked === true ? weight ?? 'reference' : null)} />
  </span>
}
