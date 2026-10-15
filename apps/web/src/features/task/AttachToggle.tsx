import { Check, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

/** 자료함 항목의 [첨부] — 누르면 입력창 칩으로 붙고, 첨부 중이면 '첨부됨'(눌림)으로 보인다 */
export function AttachToggle({ attached, onToggle, disabled, label }: { attached: boolean; onToggle: () => void; disabled?: boolean; label: string }) {
  const t = useT()
  return <Button type="button" variant={attached ? 'secondary' : 'outline'} size="sm" className="h-8 shrink-0" aria-pressed={attached}
    aria-label={t('task.materials.attachLabel', { label })} disabled={disabled} onClick={onToggle}>
    {attached && <Check />}{t(attached ? 'task.materials.attached' : 'task.materials.attach')}
  </Button>
}

/** 이 대화의 질문에 보낸 적 있음 — 작은 표시, 설명은 툴팁 */
export function UsedMark({ testId }: { testId?: string }) {
  const t = useT()
  return <span data-testid={testId} title={t('task.materials.usedTitle')} className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"><CheckCheck className="size-3" />{t('task.materials.used')}</span>
}
