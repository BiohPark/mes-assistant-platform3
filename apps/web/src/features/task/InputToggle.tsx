import { Star } from 'lucide-react'
import type { TaskInput } from '@mes/domain'

type Weight = TaskInput['weight']
export function InputToggle({ weight, onChange, disabled, label }: { weight?: Weight; onChange: (value: Weight | null) => void; disabled?: boolean; label: string }) {
  return <span className="inline-flex items-center gap-1">
    <button type="button" disabled={disabled} aria-label={`${label} 주 입력으로 지정`} aria-pressed={weight === 'main'} onClick={() => onChange(weight === 'main' ? 'reference' : 'main')} className="rounded p-0.5 text-amber-500 disabled:opacity-40"><Star className={`size-3.5 ${weight === 'main' ? 'fill-amber-400' : ''}`} /></button>
    <input type="checkbox" disabled={disabled} aria-label={weight ? `${label} 입력 해제` : `${label} 참고 입력으로 선택`} checked={!!weight} onChange={(e) => onChange(e.target.checked ? weight ?? 'reference' : null)} />
  </span>
}
