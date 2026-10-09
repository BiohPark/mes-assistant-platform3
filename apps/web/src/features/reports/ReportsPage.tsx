import { useCallback, useState } from 'react'
import { useT } from '@/i18n'
import { Chip } from '@/components/Chip'
import { PersonPicker } from '@/components/PersonPicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Download, Star } from 'lucide-react'
import { Link } from 'react-router'
import { feedbackDigestMarkdown, type Granularity } from '@mes/domain'
import { getReport } from '@/api/reports'
import { TopBar } from '@/app/TopBar'
import { Button } from '@/components/ui/button'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { SrStatusBadge } from '@/components/StatusBadges'
import { TagChip } from '@/components/TagChip'
import { useDates } from '@/lib/dates'
import { BarsChart } from './charts'

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="rounded-xl border bg-card p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>{action}</div>{children}</section>
}

export function ReportsPage() {
  const t = useT()
  const { formatDateTime } = useDates()
  const [days, setDays] = useState(30)
  const [granularity, setGranularity] = useState<Granularity>('week')
  const [userId, setUserId] = useState('')
  const report = useQuery({ queryKey: ['reports', days, granularity, userId], queryFn: () => getReport(days, granularity, userId) })
  const data = report.data
  const peopleSource = useCallback(() => data?.users.map(user => ({ value: user.id, label: user.name })) ?? [], [data?.users])
  const person = data?.users.find(user => user.id === userId)
  const assistants = new Map(data?.assistants.map((item) => [item.id, item]))
  const download = () => {
    if (!data) return
    const url = URL.createObjectURL(new Blob([feedbackDigestMarkdown(data.digest)], { type: 'text/markdown' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'feedback-digest.md'
    link.click()
    URL.revokeObjectURL(url)
  }
  return <>
    <TopBar title={t('nav.reports')} />
    <div className="flex-1 space-y-4 overflow-auto p-4 lg:p-6">
      <div className="flex flex-wrap gap-2" aria-label={t('reports.periodLabel')}>
        {[7, 30, 90].map((value) => <Button key={value} size="sm" variant={days === value ? 'default' : 'outline'} onClick={() => setDays(value)}>{t('reports.days', { count: value })}</Button>)}
        {(['day', 'week'] as const).map((value) => <Button key={value} size="sm" variant={granularity === value ? 'default' : 'outline'} onClick={() => setGranularity(value)}>{value === 'day' ? t('reports.day') : t('reports.week')}</Button>)}
        {data && <Popover><PopoverTrigger asChild><button type="button" aria-pressed={!!userId} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"><Chip variant="filter" label={t('reports.ownerFilter', { name: person?.name ?? t('common.all') })} selected={!!userId} /></button></PopoverTrigger>
          <PopoverContent align="start"><PersonPicker mode="single" source={peopleSource} value={person ? { value: person.id, label: person.name } : null}
            onChange={option => setUserId(option?.value ?? '')} aria-label={t('reports.owner')} />
            <Chip label={t('common.all')} selected={!userId} onClick={() => setUserId('')} className="mt-1.5" />
          </PopoverContent></Popover>}
      </div>
      {report.isPending && <p className="text-sm text-muted-foreground">{t('reports.loading')}</p>}
      {report.isError && <p role="alert" className="text-sm text-destructive">{t('reports.loadFailed')} <Button size="xs" variant="outline" onClick={() => void report.refetch()}>{t('common.retry')}</Button></p>}
      {data && <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{[
          [t('reports.doneTasks'), data.kpi.done, t('reports.unitCount')], [t('reports.avgLead'), data.kpi.avgLead, t('reports.unitDays')], [t('reports.reopens'), data.kpi.reopens, t('reports.unitCount')],
          [t('reports.checkRate'), data.kpi.checkRate, '%'], [t('reports.srLead'), data.kpi.srLead, t('reports.unitDays')],
        ].map(([label, value, unit]) => <div key={label} className="rounded-xl border bg-card px-3 py-2"><div className="text-xs text-muted-foreground">{label}</div><strong className="text-lg">{value ?? '-'}</strong><span className="ml-0.5 text-xs text-muted-foreground">{value === undefined ? '' : unit}</span></div>)}</div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('reports.doneTrend')}><BarsChart data={data.buckets} xKey="label" series={[{ key: 'done', name: t('reports.doneTasks') }]} /></Card>
          <Card title={t('reports.assistantLead')}><BarsChart data={data.assistantStats.filter((row) => row.avgLeadDays !== undefined).map((row) => ({ name: row.assistant.name, days: row.avgLeadDays }))} xKey="name" series={[{ key: 'days', name: t('reports.avgDays') }]} unit={t('reports.unitDays')} highlightMax /></Card>
          <Card title={t('reports.userActivity')}><BarsChart data={data.userStats} xKey="name" stacked series={[{ key: 'messages', name: t('reports.messages') }, { key: 'checks', name: t('reports.checks') }, { key: 'completed', name: t('reports.completed') }, { key: 'files', name: t('reports.files') }]} /></Card>
          <Card title={t('reports.srDistribution')}><div className="space-y-1.5">{data.srDist.map(({ status, count }) => <div key={status} className="flex items-center gap-2 text-xs"><SrStatusBadge status={status} className="w-20 justify-center" /><div className="h-2 flex-1 rounded-full bg-muted"><div className="h-full rounded-full bg-tone-info-fg" style={{ width: `${count / (data.srDist.reduce((total, row) => total + row.count, 0) || 1) * 100}%` }} /></div><span>{count}</span></div>)}</div></Card>
          <Card title={t('reports.flow')}><ul className="space-y-1.5 text-xs">{data.flow.map((edge) => <li key={`${edge.fromAssistantId}-${edge.toAssistantId}`} className="flex items-center gap-2 rounded-lg border p-2"><span>{assistants.get(edge.fromAssistantId)?.name ?? edge.fromAssistantId}</span><ArrowRight className="size-3" /><span>{assistants.get(edge.toAssistantId)?.name ?? edge.toAssistantId}</span><span className="ml-auto">{edge.count}</span></li>)}{!data.flow.length && <li className="text-muted-foreground">{t('reports.noFlow')}</li>}</ul></Card>
          <Card title={t('reports.tagConversations')}><ul className="space-y-1.5 text-xs">{data.tags.map((row) => <li key={row.tag} className="flex items-center gap-2 rounded-lg border p-2"><Link to={`/?view=kanban&tag=${encodeURIComponent(row.tag)}`}><TagChip tag={row.tag} size="xs" /></Link><span className="ml-auto">{t('reports.tagCounts', { open: row.open, count: row.conversations })}</span></li>)}{!data.tags.length && <li className="text-muted-foreground">{t('reports.noTags')}</li>}</ul></Card>
        </div>
        <Card title={t('reports.assistantStats')}><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b text-left"><th className="p-2">{t('reports.assistant')}</th><th>{t('reports.total')}</th><th>{t('reports.active')}</th><th>{t('reports.done')}</th><th>{t('reports.leadTime')}</th><th>{t('reports.feedback')}</th></tr></thead><tbody>{data.assistantStats.map((row) => <tr key={row.assistant.id} className="border-b"><td className="p-2"><Link to={`/?view=kanban&assistant=${encodeURIComponent(row.assistant.id)}`} className="flex items-center gap-2"><AssistantAvatar assistant={row.assistant} size="xs" />{row.assistant.name}</Link></td><td>{row.total}</td><td>{row.active}</td><td>{row.done}</td><td>{row.avgLeadDays ?? '-'}</td><td>{row.avgRating === undefined ? '-' : `★ ${row.avgRating}`}</td></tr>)}</tbody></table></div></Card>
        <Card title={t('reports.signals', { count: data.signals.length })}><ul className="grid gap-1.5 md:grid-cols-2">{data.signals.map((row, index) => <li key={`${row.kind}-${row.taskId}-${index}`} className="flex items-center gap-2 rounded-lg border p-2 text-xs"><AlertTriangle className="size-3.5 text-tone-warning-fg" /><span>{t(`reports.signal.${row.kind}`)}</span><Link to={`/c/${row.taskId}`} className="font-mono">{row.taskCode}</Link><span className="truncate">{row.detail}</span><span className="ml-auto text-muted-foreground">{formatDateTime(row.at)}</span></li>)}{!data.signals.length && <li className="text-xs text-muted-foreground">{t('reports.noSignals')}</li>}</ul></Card>
        <Card title={t('reports.digest')} action={<Button size="xs" variant="outline" onClick={download}><Download />markdown</Button>}><div className="grid gap-3 md:grid-cols-2">{data.digest.map((row) => <div key={row.assistantId} className="rounded-lg border p-3 text-xs"><div className="mb-2 flex items-center gap-2 text-sm font-medium">{row.assistantName}<Star className="size-3 text-tone-warning-fg" />{row.avgRating} <span className="text-muted-foreground">{t('reports.feedbackCount', { count: row.count })}</span></div>{row.comments.map((comment, index) => <p key={index} className="text-muted-foreground">★{comment.rating} {comment.comment || t('reports.noComment')} — {comment.by}, {comment.taskCode}</p>)}</div>)}{!data.digest.length && <p className="text-xs text-muted-foreground">{t('reports.noFeedback')}</p>}</div></Card>
      </>}
    </div>
  </>
}
