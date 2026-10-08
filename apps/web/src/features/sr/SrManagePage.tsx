import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, SearchX } from 'lucide-react'
import { TopBar } from '@/app/TopBar'
import { getSr, listSr } from '@/api/sr'
import { useT } from '@/i18n'
import { useUserMap } from '@/app/hooks'
import { useDates } from '@/lib/dates'
import { Chip } from '@/components/Chip'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SrStatusBadge } from '@/components/StatusBadges'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { SrDetailSheet } from './SrDetailSheet'
import { SrLoadError, SrSkeleton } from './SrStates'

const statuses = ['submitted', 'reviewing', 'in_progress', 'responded', 'done', 'rejected'] as const

export function SrManagePage() {
  const t = useT()
  const users = useUserMap()
  const { formatDate } = useDates()
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['sr', 'inbox'], queryFn: () => listSr('inbox') })
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const selected = useQuery({ queryKey: ['sr', selectedId], queryFn: () => getSr(selectedId), enabled: !!selectedId })
  const needle = search.trim().toLocaleLowerCase()
  const submitted = (list.data ?? []).filter(row => row.status !== 'draft')
  const visible = submitted.filter(row => (!status || row.status === status) && (!needle || `${row.code} ${row.title} ${row.body}`.toLocaleLowerCase().includes(needle)))
  return <><TopBar title={t('nav.srManage')} /><div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
    <p className="text-sm text-muted-foreground">{t('sr.manageDescription')}</p>
    <Input aria-label={t('sr.search')} placeholder={t('sr.searchPlaceholder')} value={search} onChange={event => setSearch(event.target.value)} />
    <div className="flex flex-wrap gap-2"><Chip variant="filter" label={t('sr.all')} selected={!status} onClick={() => setStatus('')} />{statuses.map(value => <Chip key={value} variant="filter" label={t(`status.sr.${value}`)} selected={status === value} onClick={() => setStatus(status === value ? '' : value)} />)}</div>
    {list.isPending && <SrSkeleton rows={4} className="h-12" />}
    {list.isError && <SrLoadError error={list.error} retrying={list.isFetching} onRetry={() => { void list.refetch() }} />}
    {list.data && submitted.length === 0 && <EmptyState icon={Inbox} title={t('sr.noRequests')} />}
    {submitted.length > 0 && visible.length === 0 && <EmptyState icon={SearchX} title={t('sr.noMatching')} action={<div className="flex flex-wrap justify-center gap-2">
      {needle && <Button size="sm" variant="outline" onClick={() => setSearch('')}>{t('sr.clearSearch')}</Button>}
      {status && <Button size="sm" variant="outline" onClick={() => setStatus('')}>{t('sr.resetStatus')}</Button>}
    </div>} />}
    {visible.length > 0 && <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr>
      <th className="p-3">{t('sr.title')}</th><th className="p-3">{t('sr.status')}</th><th className="p-3">{t('sr.requester')}</th><th className="p-3">{t('sr.submittedAt')}</th><th className="p-3">{t('sr.linkedCount')}</th>
    </tr></thead><tbody>{visible.map(row => <tr key={row.id} className="border-t hover:bg-muted/30" onClick={() => setSelectedId(row.id)}>
      <td className="p-3"><button type="button" className="text-left hover:underline" onClick={() => setSelectedId(row.id)}><span className="block text-xs text-muted-foreground">{row.code}</span>{row.title}</button></td>
      <td className="p-3"><SrStatusBadge status={row.status} /></td><td className="p-3">{row.requesterName || users.get(row.requesterId)?.name || t('sr.requester')}</td><td className="p-3"><time dateTime={row.submittedAt}>{formatDate(row.submittedAt)}</time></td><td className="p-3">{row.conversations.length}</td>
    </tr>)}</tbody></table></div>}
    <Sheet open={!!selectedId} onOpenChange={open => { if (!open) setSelectedId('') }}><SheetContent className="w-full sm:max-w-2xl">
      <SheetHeader><SheetTitle>{t('nav.srManage')}</SheetTitle><SheetDescription>{t('sr.manageDescription')}</SheetDescription></SheetHeader>
      {selected.error && <p role="alert">{String(selected.error)}</p>}
      {selected.data && <SrDetailSheet key={selectedId} sr={selected.data} onSaved={() => { void client.invalidateQueries({ queryKey: ['sr'] }) }} />}
    </SheetContent></Sheet>
  </div></>
}
