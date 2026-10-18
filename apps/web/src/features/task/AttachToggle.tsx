import { useEffect, useRef, useState } from 'react'
import { CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

/** 연결 자료를 입력창 칩에 담는다. SR 접수 화면은 기존 첨부 문구를 사용한다. */
export function AttachToggle({ attached, onToggle, disabled, label, inputLabels = false }: { attached: boolean; onToggle: () => void; disabled?: boolean; label: string; inputLabels?: boolean }) {
  const t = useT()
  const previous = useRef(attached)
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    if (attached && !previous.current) setAnnouncement(t('task.materials.addedAnnouncement', { label }))
    if (!attached) setAnnouncement('')
    previous.current = attached
  }, [attached, label, t])
  return <><Button type="button" variant={attached ? 'secondary' : 'outline'} size="sm" className="h-8 shrink-0" aria-pressed={attached}
    aria-label={inputLabels ? `${t(attached ? 'task.materials.addedToInput' : 'task.materials.addToInput')} · ${label}` : t('task.materials.attachLabel', { label })} disabled={disabled} onClick={onToggle}>
    {t(inputLabels ? attached ? 'task.materials.addedToInput' : 'task.materials.addToInput' : attached ? 'task.materials.attached' : 'task.materials.attach')}
  </Button><span className="sr-only" aria-live="polite">{announcement}</span></>
}

/** 이 대화의 질문에 보낸 적 있음 — 작은 표시, 설명은 툴팁 */
export function UsedMark({ testId }: { testId?: string }) {
  const t = useT()
  return <span data-testid={testId} title={t('task.materials.usedTitle')} className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"><CheckCheck className="size-3" />{t('task.materials.used')}</span>
}
