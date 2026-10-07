import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Download, Star } from 'lucide-react'
import { Link } from 'react-router'
import { feedbackDigestMarkdown, SIGNAL_LABEL, type Granularity } from '@mes/domain'
import { getReport } from '@/api/reports'
import { TopBar } from '@/app/TopBar'
import { Button } from '@/components/ui/button'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { SrStatusBadge } from '@/components/StatusBadges'
import { TagChip } from '@/components/TagChip'
import { formatDateTime } from '@/lib/dates'
import { BarsChart } from './charts'

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="rounded-xl border bg-card p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>{action}</div>{children}</section>
}

export function ReportsPage() {
  const [days, setDays] = useState(30)
  const [granularity, setGranularity] = useState<Granularity>('week')
  const [userId, setUserId] = useState('')
  const report = useQuery({ queryKey: ['reports', days, granularity, userId], queryFn: () => getReport(days, granularity, userId) })
  const data = report.data
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
    <TopBar title="리포트" />
    <div className="flex-1 space-y-4 overflow-auto p-4 lg:p-6">
      <div className="flex flex-wrap gap-2" aria-label="리포트 기간과 단위">
        {[7, 30, 90].map((value) => <Button key={value} size="sm" variant={days === value ? 'default' : 'outline'} onClick={() => setDays(value)}>{value}일</Button>)}
        {(['day', 'week'] as const).map((value) => <Button key={value} size="sm" variant={granularity === value ? 'default' : 'outline'} onClick={() => setGranularity(value)}>{value === 'day' ? '일' : '주'}</Button>)}
        {data && <label className="flex items-center gap-1 text-xs">담당자 <select className="h-7 rounded-lg border bg-background px-2" value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">전체</option>{data.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>}
      </div>
      {report.isPending && <p className="text-sm text-muted-foreground">리포트를 불러오는 중입니다.</p>}
      {report.isError && <p role="alert" className="text-sm text-destructive">리포트를 불러오지 못했습니다. <Button size="xs" variant="outline" onClick={() => void report.refetch()}>다시 시도</Button></p>}
      {data && <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{[
          ['완료 업무', data.kpi.done, '건'], ['평균 리드타임', data.kpi.avgLead, '일'], ['재오픈', data.kpi.reopens, '건'],
          ['체크리스트 이행률', data.kpi.checkRate, '%'], ['SR 접수→완료', data.kpi.srLead, '일'],
        ].map(([label, value, unit]) => <div key={label} className="rounded-xl border bg-card px-3 py-2"><div className="text-xs text-muted-foreground">{label}</div><strong className="text-lg">{value ?? '-'}</strong><span className="ml-0.5 text-xs text-muted-foreground">{value === undefined ? '' : unit}</span></div>)}</div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="완료 추이"><BarsChart data={data.buckets} xKey="label" series={[{ key: 'done', name: '완료 업무' }]} /></Card>
          <Card title="에이전트별 평균 리드타임 (최대값 강조)"><BarsChart data={data.assistantStats.filter((row) => row.avgLeadDays !== undefined).map((row) => ({ name: row.assistant.name, days: row.avgLeadDays }))} xKey="name" series={[{ key: 'days', name: '평균 일수' }]} unit="일" highlightMax /></Card>
          <Card title="사용자별 활동"><BarsChart data={data.userStats} xKey="name" stacked series={[{ key: 'messages', name: '메시지' }, { key: 'checks', name: '체크' }, { key: 'completed', name: '완료' }, { key: 'files', name: '파일' }]} /></Card>
          <Card title="SR 상태 분포"><div className="space-y-1.5">{data.srDist.map(({ status, count }) => <div key={status} className="flex items-center gap-2 text-xs"><SrStatusBadge status={status} className="w-20 justify-center" /><div className="h-2 flex-1 rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${count / (data.srDist.reduce((total, row) => total + row.count, 0) || 1) * 100}%` }} /></div><span>{count}</span></div>)}</div></Card>
          <Card title="자료 흐름 (출처 에이전트 → 입력으로 쓴 에이전트)"><ul className="space-y-1.5 text-xs">{data.flow.map((edge) => <li key={`${edge.fromAssistantId}-${edge.toAssistantId}`} className="flex items-center gap-2 rounded-lg border p-2"><span>{assistants.get(edge.fromAssistantId)?.name ?? edge.fromAssistantId}</span><ArrowRight className="size-3" /><span>{assistants.get(edge.toAssistantId)?.name ?? edge.toAssistantId}</span><span className="ml-auto">{edge.count}</span></li>)}{!data.flow.length && <li className="text-muted-foreground">다른 대화의 파일을 입력으로 고른 기록이 없습니다.</li>}</ul></Card>
          <Card title="태그별 대화"><ul className="space-y-1.5 text-xs">{data.tags.map((row) => <li key={row.tag} className="flex items-center gap-2 rounded-lg border p-2"><Link to={`/?view=kanban&tag=${encodeURIComponent(row.tag)}`}><TagChip tag={row.tag} size="xs" /></Link><span className="ml-auto">진행 {row.open} · {row.conversations}건</span></li>)}{!data.tags.length && <li className="text-muted-foreground">태그가 붙은 대화가 없습니다.</li>}</ul></Card>
        </div>
        <Card title="에이전트별 현황"><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b text-left"><th className="p-2">에이전트</th><th>전체</th><th>진행</th><th>완료</th><th>리드타임</th><th>피드백</th></tr></thead><tbody>{data.assistantStats.map((row) => <tr key={row.assistant.id} className="border-b"><td className="p-2"><Link to={`/?view=kanban&assistant=${encodeURIComponent(row.assistant.id)}`} className="flex items-center gap-2"><AssistantAvatar assistant={row.assistant} size="xs" />{row.assistant.name}</Link></td><td>{row.total}</td><td>{row.active}</td><td>{row.done}</td><td>{row.avgLeadDays ?? '-'}</td><td>{row.avgRating === undefined ? '-' : `★ ${row.avgRating}`}</td></tr>)}</tbody></table></div></Card>
        <Card title={`비효율 신호 ${data.signals.length}`}><ul className="grid gap-1.5 md:grid-cols-2">{data.signals.map((row, index) => <li key={`${row.kind}-${row.taskId}-${index}`} className="flex items-center gap-2 rounded-lg border p-2 text-xs"><AlertTriangle className="size-3.5 text-amber-500" /><span>{SIGNAL_LABEL[row.kind]}</span><Link to={`/c/${row.taskId}`} className="font-mono">{row.taskCode}</Link><span className="truncate">{row.detail}</span><span className="ml-auto text-muted-foreground">{formatDateTime(row.at)}</span></li>)}{!data.signals.length && <li className="text-xs text-muted-foreground">감지된 신호가 없습니다.</li>}</ul></Card>
        <Card title="assistant 피드백 다이제스트" action={<Button size="xs" variant="outline" onClick={download}><Download />markdown</Button>}><div className="grid gap-3 md:grid-cols-2">{data.digest.map((row) => <div key={row.assistantId} className="rounded-lg border p-3 text-xs"><div className="mb-2 flex items-center gap-2 text-sm font-medium">{row.assistantName}<Star className="size-3 text-amber-500" />{row.avgRating} <span className="text-muted-foreground">{row.count}건</span></div>{row.comments.map((comment, index) => <p key={index} className="text-muted-foreground">★{comment.rating} {comment.comment || '(코멘트 없음)'} — {comment.by}, {comment.taskCode}</p>)}</div>)}{!data.digest.length && <p className="text-xs text-muted-foreground">피드백이 없습니다.</p>}</div></Card>
      </>}
    </div>
  </>
}
