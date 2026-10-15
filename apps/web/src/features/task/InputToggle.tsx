import { Star, X } from 'lucide-react'
import type { TaskInput } from '@mes/domain'
import { Checkbox } from '@/components/ui/checkbox'
import { useT } from '@/i18n'

type Weight = TaskInput['weight']
/** 자료함 행의 담기 체크. showMain이면 ★ 주 입력 버튼도 함께 보인다 */
export function InputToggle({ weight, onChange, disabled, label, showMain = true }: { weight?: Weight; onChange: (value: Weight | null) => void; disabled?: boolean; label: string; showMain?: boolean }) {
  const t = useT()
  return <span className="inline-flex shrink-0 items-center">
    {showMain && <button type="button" disabled={disabled} aria-label={t('task.inputs.setMain', { label })} aria-pressed={weight === 'main'} onClick={() => onChange(weight === 'main' ? 'reference' : 'main')} className="inline-flex size-8 items-center justify-center rounded-lg text-tone-warning-fg hover:bg-muted disabled:opacity-40"><Star className={`size-3.5 ${weight === 'main' ? 'fill-tone-warning-fg' : ''}`} /></button>}
    <label className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-muted has-disabled:cursor-not-allowed">
      <Checkbox disabled={disabled} aria-label={weight ? t('task.inputs.remove', { label }) : t('task.inputs.selectReference', { label })} checked={!!weight} onCheckedChange={(checked) => onChange(checked === true ? weight ?? 'reference' : null)} />
    </label>
  </span>
}

/** '다음 질문에 보낼 자료' 행의 ★ 주 입력 · × 빼기 */
export function StagedToggle({ weight, onChange, disabled, label }: { weight: Weight; onChange: (value: Weight | null) => void; disabled?: boolean; label: string }) {
  const t = useT()
  return <span className="inline-flex shrink-0 items-center">
    <button type="button" disabled={disabled} aria-label={t('task.inputs.setMain', { label })} aria-pressed={weight === 'main'} onClick={() => onChange(weight === 'main' ? 'reference' : 'main')} className="inline-flex size-8 items-center justify-center rounded-lg text-tone-warning-fg hover:bg-muted disabled:opacity-40"><Star className={`size-3.5 ${weight === 'main' ? 'fill-tone-warning-fg' : ''}`} /></button>
    <button type="button" disabled={disabled} aria-label={t('task.materials.unstage', { label })} onClick={() => onChange(null)} className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-40"><X className="size-3.5" /></button>
  </span>
}
