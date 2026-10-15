import { useT } from '@/i18n'
import { useOpenSr } from '@/app/useOpenSr'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function LinkedSrChip({ codes, interactive = true }: { codes?: string[]; interactive?: boolean }) {
  const t = useT()
  const openSr = useOpenSr()
  const unique = [...new Set(codes)]
  if (!interactive) return unique.length ? <span title={unique.join(', ')} aria-label={t('myWork.linkedSrs', { count: unique.length })} className="shrink-0 rounded-full border px-1.5 py-0.5 text-[11px]">SR {unique.length}</span> : null
  return unique.length ? <Popover><PopoverTrigger asChild><button type="button" title={unique.join(', ')} aria-label={t('myWork.linkedSrs', { count: unique.length })} className="relative z-10 shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] hover:bg-muted">SR {unique.length}</button></PopoverTrigger><PopoverContent className="w-auto p-2"><div className="flex flex-col gap-1">{unique.map(code => <button key={code} type="button" className="rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-muted" onClick={() => void openSr(code)}>{code}</button>)}</div></PopoverContent></Popover> : null
}
