import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Info } from 'lucide-react'
import { normalizeTag, tagKey } from '@mes/domain'
import { TopBar } from '@/app/TopBar'
import { useActor, useUserMap } from '@/app/hooks'
import { useTagSuggest } from '@/app/useTagSuggest'
import { deleteTask, startConversation } from '@/api/tasks'
import { appendMessage } from '@/api/tasks'
import { setInput, uploadFile } from '@/api/files'
import { listAssistants } from '@/lib/catalog'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { AssistantStatusBadge } from '@/components/StatusBadges'
import { TagInput } from '@/components/TagInput'
import { Markdown } from '@/components/Markdown'
import { UserAvatar } from '@/components/UserAvatar'
import { Composer, type PendingAttachment } from '@/features/chat/Composer'
import { suggestionsFrom } from '@/features/chat/suggestions'

/** 카드 클릭은 초안만 연다. 첫 팀 의견을 보낼 때 대화와 스레드가 생성된다. */
export function DraftConversationPage() {
  const { assistantId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const actor = useActor()
  const users = useUserMap()
  const suggest = useTagSuggest()
  const { data: assistants, isPending } = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const assistant = assistants?.find((item) => item.id === assistantId)
  const [tags, setTags] = useState(() => params.getAll('tag').map(normalizeTag).filter(Boolean))
  const [showUsage, setShowUsage] = useState(false)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const refId = params.get('ref')

  if (isPending) return <><TopBar title="새 대화" /><div className="p-6 text-sm text-muted-foreground">불러오는 중…</div></>
  if (!assistant) return <Navigate to="/" replace />
  const retired = assistant.status === 'retired'
  const owner = users.get(assistant.ownerId)

  async function send(text: string, attachments: PendingAttachment[]) {
    if (!assistant || (!text.trim() && !attachments.length) || sending.current) return
    sending.current = true
    setBusy(true)
    try {
      const { task } = await startConversation(actor, { assistantId: assistant.id, tags, ...(refId && { referenceTaskId: refId }), ...(!attachments.length && text.trim() && { firstMessage: text.trim() }) })
      try {
        if (attachments.length) {
          const uploaded: string[] = []
          for (const attachment of attachments) {
            const file = await uploadFile(actor, { taskId: task.id }, attachment.file)
            uploaded.push(file.id)
            if (!attachment.once) await setInput(actor, task.id, file.id, 'reference')
          }
          await appendMessage(actor, task.threadId!, 'user', text.trim(), uploaded, 'done', 'discussion')
        }
      } catch (error) {
        const removed = await deleteTask(task.id)
        if (!removed.ok) throw new Error(`${error instanceof Error ? error.message : String(error)} · 대화 ${task.code}가 남았습니다`)
        throw error
      }
      navigate(`/c/${task.id}`, { replace: true })
    } catch (error) {
      sending.current = false
      setBusy(false)
      throw error
    }
  }

  return <>
    <TopBar title={`새 대화 · ${assistant.name}`} />
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
          <div className="flex items-start gap-3">
            <AssistantAvatar assistant={assistant} size="md" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-muted-foreground">{assistant.level1} › {assistant.level2}</div>
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold">{assistant.name}</h1><AssistantStatusBadge status={assistant.status} /></div>
              <p className="mt-1 text-sm text-muted-foreground">{assistant.summary}</p>
              {owner && <span className="mt-2 inline-flex items-center gap-1 text-xs"><UserAvatar user={owner} size="xs" />{owner.name}</span>}
            </div>
          </div>
          {(assistant.expectedInputs.length > 0 || assistant.expectedOutputs.length > 0) && <div className="flex flex-wrap items-center gap-1.5 rounded-xl border bg-muted/30 p-3 text-[11px]">
            {assistant.expectedInputs.map((item) => <span key={item} className="rounded-full border bg-background px-2 py-0.5">{item}</span>)}
            {assistant.expectedInputs.length > 0 && assistant.expectedOutputs.length > 0 && <ArrowRight className="size-3.5 text-muted-foreground" />}
            {assistant.expectedOutputs.map((item) => <span key={item} className="rounded-full border bg-violet-50 px-2 py-0.5 text-violet-800">{item}</span>)}
          </div>}
          <div className="space-y-1.5"><div className="text-xs font-medium">태그</div>
            <TagInput tags={tags} suggest={suggest} onAdd={(value) => setTags((current) => current.some((item) => tagKey(item) === tagKey(value)) ? current : [...current, value])} onRemove={(value) => setTags((current) => current.filter((item) => item !== value))} placeholder="SR 번호·키워드" />
          </div>
          {refId && <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-3 text-xs">참조 대화 {refId} · 참조 선택은 S3에서 지원합니다.</div>}
          {assistant.usageExample && <div className="rounded-xl border"><button type="button" className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium" onClick={() => setShowUsage(!showUsage)}><Info className="size-3.5" />사용법 {showUsage ? '접기' : '보기'}</button>{showUsage && <Markdown content={assistant.usageExample} className="border-t px-3 py-2 text-sm" />}</div>}
          {retired && <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">폐기된 에이전트입니다. <Link to="/" className="underline">다른 에이전트 고르기</Link></div>}
        </div>
      </div>
      {!retired && <div className="mx-auto w-full max-w-2xl"><Composer disabled={busy} streaming={false} allowAttachments allowPin onSend={async (text, attachments) => send(text, attachments)} onStop={() => undefined} suggestions={suggestionsFrom(assistant.usageExample)} /></div>}
    </div>
  </>
}
