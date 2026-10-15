import { Link } from 'react-router'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, SearchX } from 'lucide-react'
import { TopBar } from '@/app/TopBar'
import { getSr, listSr } from '@/api/sr'
import { useT } from '@/i18n'
import { useCurrentUserId, useUserMap } from '@/app/hooks'
import { useDates } from '@/lib/dates'
import { Chip } from '@/components/Chip'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SrStatusBadge } from '@/components/StatusBadges'
import { SortHeader } from '@/components/SortHeader'
import { useSort } from '@/lib/useSort'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { SrDetailSheet } from './SrDetailSheet'
import { SrLoadError, SrSkeleton } from './SrStates'
import { SR_STAGES, srElapsedDays, srStage, type SrStage } from '@mes/domain'

export function SrManagePage() {
  const t = useT()
  const users = useUserMap()
  const actor = useCurrentUserId()
  const { formatDate } = useDates()
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['sr', 'inbox'], queryFn: () => listSr('inbox') })
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [queue, setQueue] = useState<'' | 'unstarted' | 'mine'>('')
  const [status, setStatus] = useState<SrStage | ''>('')
  const selected = useQuery({ queryKey: ['sr', selectedId], queryFn: () => getSr(selectedId), enabled: !!selectedId })
  const needle = search.trim().toLocaleLowerCase()
  const submitted = (list.data ?? []).filter(row => row.status !== 'draft')
  const taskCount = (row: typeof submitted[number]) => row.taskCount ?? row.conversations.length
  const elapsed = (row: typeof submitted[number]) => row.elapsedDays ?? srElapsedDays(row.submittedAt)
  const visible = submitted.filter(row => (!status || srStage(row.status) === status) &&
    (!queue || (queue === 'unstarted' ? srStage(row.status) === 'submitted' && taskCount(row) === 0 : row.conversations.some(task => task.ownerId === actor || task.assigneeIds?.includes(actor)))) &&
    (!needle || `${row.code} ${row.title} ${row.body}`.toLocaleLowerCase().includes(needle)))
  type Row = typeof submitted[number]
  /** 기본은 경과일 내림차순 — 열 머리로 바꿀 수 있다 */
  const sorted = useSort(visible, {
    title: (row: Row) => row.title, status: (row: Row) => SR_STAGES.indexOf(srStage(row.status)), requester: (row: Row) => row.requesterName || users.get(row.requesterId)?.name,
    submittedAt: (row: Row) => row.submittedAt && Date.parse(row.submittedAt), elapsed, linked: taskCount,
  }, (a, b) => elapsed(b) - elapsed(a) || Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || a.id.localeCompare(b.id))
  const header = (column: Parameters<typeof sorted.toggle>[0], label: string) => <SortHeader column={column} sort={sorted.sort} onToggle={sorted.toggle} className="p-3">{label}</SortHeader>
  const emptyKey = needle ? 'sr.noMatching' : queue === 'unstarted' ? 'sr.noUnstarted' : queue === 'mine' ? 'sr.noMyLinked' : status ? 'sr.noMatchingStatus' : 'sr.noRequests'
  const myRequests = <Link to="/sr" className="text-sm text-primary underline">{t('sr.myRequestsLink')}</Link>
  return <><TopBar title={t('nav.srManage')} /><div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
    <p className="text-sm text-muted-foreground">{t('sr.manageDescription')}</p>
    <Input data-tour="sr-search" aria-label={t('sr.search')} placeholder={t('sr.searchPlaceholder')} value={search} onChange={event => setSearch(event.target.value)} />
    <div className="flex flex-wrap gap-2"><Chip variant="filter" label={t('sr.all')} selected={!status && !queue} onClick={() => { setStatus(''); setQueue('') }} />
      <Chip variant="filter" label={t('sr.unstarted')} selected={queue === 'unstarted'} onClick={() => setQueue(queue === 'unstarted' ? '' : 'unstarted')} />
      <Chip variant="filter" label={t('sr.myLinked')} selected={queue === 'mine'} onClick={() => setQueue(queue === 'mine' ? '' : 'mine')} />{SR_STAGES.map(value => <Chip key={value} variant="filter" label={t(`status.sr.${value}`)} selected={status === value} onClick={() => setStatus(status === value ? '' : value)} />)}</div>
    {list.isPending && <SrSkeleton rows={4} className="h-12" />}
    {list.isError && <SrLoadError error={list.error} retrying={list.isFetching} onRetry={() => { void list.refetch() }} />}
    {list.data && visible.length === 0 && <EmptyState icon={submitted.length ? SearchX : Inbox} title={t(emptyKey)} action={<div className="flex flex-wrap items-center justify-center gap-2">
      {needle && <Button size="sm" variant="outline" onClick={() => setSearch('')}>{t('sr.clearSearch')}</Button>}
      {(status || queue) && <Button size="sm" variant="outline" onClick={() => { setStatus(''); setQueue('') }}>{t('sr.resetStatus')}</Button>}
      {myRequests}
    </div>} />}
    {visible.length > 0 && <div className="overflow-x-auto rounded-lg border" data-tour="sr-table"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr>
      {header('title', t('sr.title'))}{header('status', t('sr.status'))}{header('requester', t('sr.requester'))}{header('submittedAt', t('sr.submittedAt'))}{header('elapsed', t('sr.elapsedDays'))}{header('linked', t('sr.linkedCount'))}<th className="p-3">{t('sr.linkedConversations')}</th>
    </tr></thead><tbody>{sorted.rows.map(row => <tr key={row.id} className="border-t hover:bg-muted/30" onClick={() => setSelectedId(row.id)}>
      <td className="p-3"><button type="button" className="text-left hover:underline" onClick={() => setSelectedId(row.id)}><span className="block text-xs text-muted-foreground">{row.code}</span>{row.title}</button></td>
      <td className="p-3"><SrStatusBadge status={row.status} /></td><td className="p-3">{row.requesterName || users.get(row.requesterId)?.name || t('sr.requester')}</td><td className="p-3"><time dateTime={row.submittedAt}>{formatDate(row.submittedAt)}</time></td><td className="p-3">{t('sr.elapsedDaysValue', { days: elapsed(row) })}</td><td className="p-3">{taskCount(row)}</td>
      <td className="p-3"><div className="flex flex-wrap gap-2">{row.conversations.map(task => <Link key={task.id} to={`/c/${task.id}`} className="text-primary underline" onClick={event => event.stopPropagation()}>{task.code}</Link>)}</div></td>
    </tr>)}</tbody></table></div>}
    <Sheet open={!!selectedId} onOpenChange={open => { if (!open) setSelectedId('') }}><SheetContent className="w-full sm:max-w-2xl">
      <SheetHeader><SheetTitle>{t('nav.srManage')}</SheetTitle><SheetDescription>{t('sr.manageDescription')}</SheetDescription></SheetHeader>
      {selected.error && <p role="alert">{String(selected.error)}</p>}
      {selected.data && <SrDetailSheet key={selectedId} sr={selected.data} onSaved={() => { void client.invalidateQueries({ queryKey: ['sr'] }) }} />}
    </SheetContent></Sheet>
  </div></>
}
