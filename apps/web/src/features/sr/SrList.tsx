import type { SrDetail } from '@/api/sr'

export function SrList({ rows, selectedId, onSelect }: { rows: SrDetail[]; selectedId?: string; onSelect: (id: string) => void }) {
  return <div className="space-y-1">{rows.map((sr) => <button key={sr.id} type="button" onClick={() => onSelect(sr.id)}
    className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${selectedId === sr.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
    <span className="font-medium">{sr.code || '접수 전 대화'}</span><span className="ml-2 text-muted-foreground">{sr.status}</span>
    <div className="truncate">{sr.title || '새 접수 대화'}</div>
  </button>)}{rows.length === 0 && <p className="text-sm text-muted-foreground">SR이 없습니다.</p>}</div>
}
