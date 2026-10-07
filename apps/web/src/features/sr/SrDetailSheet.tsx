import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { startSrTask, statusSr, type SrDetail } from '@/api/sr'
import { listAssistants } from '@/lib/catalog'
import { Button } from '@/components/ui/button'
import { SrTitleEditor } from './SrTitleEditor'
import { SharedResults } from './SharedResults'
import { ShareResultDialog } from './ShareResultDialog'
import { useT } from '@/i18n'
import { useUserMap } from '@/app/hooks'
import { TASK_STATUS_KEY } from '@/lib/labels'
import type { TaskStatus } from '@mes/domain'
import { useMe } from '@/app/auth'

export function SrDetailSheet({ sr, onSaved }: { sr: SrDetail; onSaved: () => void }) {
  const t = useT()
  const users = useUserMap()
  const me = useMe()
  const [assistantId, setAssistantId] = useState('')
  const [candidates, setCandidates] = useState<SrDetail['conversations']>([])
  const [shareOpen, setShareOpen] = useState(false)
  const { data: assistants = [] } = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  async function start(forceNew = false) {
    if (!assistantId) return
    try {
      const result = await startSrTask(sr.id, assistantId, forceNew)
      if (result.candidates) setCandidates(result.candidates)
      else { setCandidates([]); onSaved() }
    } catch (error) { toast.error(String(error)) }
  }
  return <div className="space-y-4 rounded-lg border p-4"><header><h2 className="text-lg font-semibold">{sr.code} {sr.title}</h2>
    <p className="text-sm text-muted-foreground">{t('sr.requesterStatus', { name: users.get(sr.requesterId)?.name ?? t('sr.requester'), status: t(`status.sr.${sr.status}`) })}</p></header>
    <p className="whitespace-pre-wrap text-sm">{sr.body}</p>
    <div className="flex gap-2"><select aria-label="SR 상태" value={sr.status} onChange={async (event) => { try { await statusSr(sr.id, event.target.value); onSaved() } catch (error) { toast.error(String(error)) } }} className="rounded-lg border p-2 text-sm">
      {(['submitted', 'reviewing', 'in_progress', 'responded', 'done', 'rejected'] as const).map((status) => <option key={status} value={status}>{t(`status.sr.${status}`)}</option>)}
    </select><Button onClick={() => setShareOpen(true)} disabled={sr.status === 'draft'}>결과 공유</Button></div>
    {sr.conversations.length > 0 && <div><h3 className="font-medium">연결 대화</h3>{sr.conversations.map((item) => <Link key={item.id} to={`/c/${item.id}`} className="block text-sm text-primary underline">{item.code} {item.title} ({t(TASK_STATUS_KEY[item.status as TaskStatus])})</Link>)}</div>}
    <div className="flex gap-2"><select aria-label="연결 업무 에이전트" value={assistantId} onChange={(event) => setAssistantId(event.target.value)} className="rounded-lg border p-2 text-sm"><option value="">에이전트 선택</option>
      {assistants.filter((item) => item.status !== 'retired').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <Button onClick={() => start()} disabled={!assistantId || sr.status === 'draft'}>연결 업무 시작</Button></div>
    {candidates.length > 0 && <div className="rounded-xl border p-3 text-sm"><p>진행 중인 연결 대화가 있습니다. 이어가기를 우선 확인하세요.</p>
      {candidates.map((item) => <Link key={item.id} to={`/c/${item.id}`} className="block text-primary underline">{item.code} 이어가기</Link>)}
      <Button variant="outline" onClick={() => start(true)}>새 대화 시작</Button></div>}
    <SharedResults results={sr.results} />
    {me.roles.includes('system_owner') && <SrTitleEditor sr={sr} onSaved={onSaved} />}
    <ShareResultDialog sr={sr} open={shareOpen} onOpenChange={setShareOpen} onSaved={onSaved} />
  </div>
}
