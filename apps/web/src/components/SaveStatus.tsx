import { useT } from '@/i18n'
import type { SaveState } from '@/lib/useAutoSave'
import { cn } from '@/lib/utils'

/** 자동 저장 결과를 필드 근처에 보인다 — 오류는 alert, 저장 중·저장됨은 status */
export function SaveStatus({ state, id, className }: { state?: SaveState; id?: string; className?: string }) {
  const t = useT()
  if (!state) return null
  if (state.status === 'error') return <p id={id} role="alert" className={cn('text-[13px] leading-5 text-destructive', className)}>{state.message || t('admin.saveFailed')}</p>
  return <p id={id} role="status" className={cn('text-[13px] leading-5 text-muted-foreground', className)}>{t(state.status === 'saving' ? 'common.saving' : 'common.saved')}</p>
}
