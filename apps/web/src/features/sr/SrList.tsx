import { useT } from '@/i18n'
import type { SrDetail } from '@/api/sr'
import { SrStatusBadge } from '@/components/StatusBadges'
import { useDates } from '@/lib/dates'

export function SrList({ rows, selectedId, disabled, onSelect }: { rows: SrDetail[]; selectedId?: string; disabled?: boolean; onSelect: (id: string) => void }) {
  const t = useT()
  const { formatRelative } = useDates()
  return <div className="space-y-1">{rows.map((sr) => <button key={sr.id} type="button" disabled={disabled} onClick={() => onSelect(sr.id)}
    className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${selectedId === sr.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
    <div className="flex items-center justify-between gap-2"><span className="font-medium">{sr.code || t('status.sr.draft')}</span><SrStatusBadge status={sr.status} /></div>
    <div className="truncate">{sr.title || sr.firstMessage?.slice(0, 40) || t('sr.untitled')}</div>
    <time className="text-xs text-muted-foreground" dateTime={sr.updatedAt}>{formatRelative(sr.updatedAt)}</time>
  </button>)}{rows.length === 0 && <p className="text-sm text-muted-foreground">{t('sr.noRequests')}</p>}</div>
}
