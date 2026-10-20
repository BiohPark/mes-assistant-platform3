import { newId } from '@/lib/ids'
import { useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { OpenWebUiIcon } from '@/components/OpenWebUiIcon'
import { normalizeTag, tagKey } from '@mes/domain'
import { TopBar } from '@/app/TopBar'
import { useActor, useUserMap } from '@/app/hooks'
import { useSrStatus, useTagSuggest } from '@/app/useTagSuggest'
import { startConversation, type StartConversationInput } from '@/api/tasks'
import { appendMessage } from '@/api/tasks'
import { ChatMessages } from '@/features/chat/ChatMessages'
import { queueFirstRequest } from '@/features/chat/useChat'
import { setInput, uploadFile } from '@/api/files'
import { listAssistants } from '@/lib/catalog'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { AssistantStatusBadge } from '@/components/StatusBadges'
import { TagInput } from '@/components/TagInput'
import { RelatedStrip } from '@/features/task/RelatedStrip'
import { Chip } from '@/components/Chip'
import { useT } from '@/i18n'
import { assistantLink1 } from '@/lib/links'
import { getSettings } from '@/api/admin'
import { UserAvatar } from '@/components/UserAvatar'
import { Composer, type ComposerHandle, type PendingAttachment } from '@/features/chat/Composer'
import { FileDropZone } from '@/components/FileDropZone'
import { suggestionsFrom } from '@/features/chat/suggestions'
import { toast } from 'sonner'

/** 카드 클릭은 초안만 연다. 첫 전송 때 대화와 스레드가 생성된다. */
export function DraftConversationPage() {
  const t = useT()
  const link1Rule = useQuery({ queryKey: ['settings'], queryFn: getSettings }).data?.link1Rule
  const { assistantId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const query = useQueryClient()
  const actor = useActor()
  const users = useUserMap()
  const suggest = useTagSuggest()
  const srStatus = useSrStatus()
  const { data: assistants, isPending } = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const assistant = assistants?.find((item) => item.id === assistantId)
  const urlTags = params.getAll('tag').map(normalizeTag).filter(Boolean)
  const [tags, setTags] = useState(urlTags)
  // 탭(MDI)이 같은 에이전트의 초안을 재사용하면 이 화면은 다시 마운트되지 않는다. 주소의 태그가 바뀌었거나 태그 프리셋 이동
  // (state.tagPreset — 헤더 [이 태그로 새 대화]·칸반 [+])이 새로 오면 그 태그로 바꾼다. 탭 칩으로 돌아오는 같은 주소 이동은 손대지 않는다
  const location = useLocation()
  const preset = (location.state as { tagPreset?: boolean } | null)?.tagPreset ? location.key : null
  const [applied, setApplied] = useState({ url: urlTags.join('\n'), preset })
  if (applied.url !== urlTags.join('\n') || (preset && preset !== applied.preset)) {
    setApplied({ url: urlTags.join('\n'), preset })
    setTags(urlTags)
  }
  const [busy, setBusy] = useState(false)
  const [waitingSince, setWaitingSince] = useState<number>()
  const sending = useRef(false)
  const composer = useRef<ComposerHandle>(null)
  const created = useRef<{ id: string; code: string; threadId: string } | null>(null)
  const refId = params.get('ref')

  if (isPending) return <><TopBar title={t('hub.newConversation')} /><div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div></>
  if (!assistant) return <Navigate to="/" replace />
  const link1 = assistantLink1('', assistant, link1Rule)
  const retired = assistant.status === 'retired'
  const owner = users.get(assistant.ownerId)

  async function send(text: string, attachments: PendingAttachment[], discussion: boolean) {
    if (!assistant || (!text.trim() && !attachments.length) || sending.current) return
    sending.current = true
    const startedAt = Date.now()
    if (!discussion) setWaitingSince(startedAt)
    setBusy(true)
    try {
      const creationKey = `mes-draft-create:${assistant.id}:${refId ?? ''}`
      const stored = sessionStorage.getItem(creationKey)
      const attempt = stored ? JSON.parse(stored) as { key: string; body: StartConversationInput } : {
        key: newId(), body: { assistantId: assistant.id, tags, ...(refId && { referenceTaskId: refId }), ...(discussion && !attachments.length && text.trim() && { firstMessage: text.trim() }) },
      }
      if (!created.current) {
        sessionStorage.setItem(creationKey, JSON.stringify(attempt))
        const { task, warnings } = await startConversation(actor, attempt.body, attempt.key)
        created.current = { id: task.id, code: task.code, threadId: task.threadId! }
        query.setQueryData(['task', task.id], task)
        sessionStorage.removeItem(creationKey)
        for (const warning of warnings) toast.warning(warning)
      }
      const task = created.current
      // 이 대화는 첫 질문(또는 팀 의견)과 함께 시작한다 — '첫 질문 전' 자동 열림을 건너뛰어, 메시지 조회 전에 자료 패널이 잠깐 열렸다 닫히지 않게
      const uploaded: string[] = []
      if (attachments.length) {
        for (const attachment of attachments) {
          if (attachment.uploadedTaskId !== task.id || !attachment.uploadedId) {
            const file = await uploadFile(actor, { taskId: task.id }, attachment.file)
            attachment.uploadedId = file.id
            attachment.uploadedTaskId = task.id
          }
          uploaded.push(attachment.uploadedId)
          if (!discussion) await setInput(actor, task.id, attachment.uploadedId, 'reference')
        }
        if (discussion) await appendMessage(actor, task.threadId, 'user', text.trim(), uploaded, 'done', 'discussion')
      }
      if (!discussion) {
        queueFirstRequest(task.threadId, { content: text.trim(), attachmentIds: uploaded,
          oneShotFileIds: [] }, startedAt, { taskId: task.id, draft: { text, pending: attachments, discussion } })
      }
      navigate(`/c/${task.id}`, { replace: true })
    } catch (error) {
      if (created.current) toast.error(t('hub.draftLeft', { code: created.current.code }))
      sending.current = false
      setBusy(false)
      setWaitingSince(undefined)
      throw error
    }
  }

  return <>
    <TopBar title={t('hub.newConversationTitle', { name: assistant.name })} />
    <FileDropZone data-testid="draft-dropzone" className="flex min-h-0 flex-1 flex-col" label={t('dropzone.toAttach')} disabled={retired || busy} onFiles={(files) => composer.current?.dropFiles(files)}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
          <div className="flex items-start gap-3">
            <AssistantAvatar assistant={assistant} size="md" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">{assistant.level1} › {assistant.level2}</div>
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold">{assistant.name}</h1><AssistantStatusBadge status={assistant.status} /></div>
              {(assistant.modelId || link1 || assistant.docUrl) && <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {assistant.modelId && <Chip label={assistant.modelId} title={t('admin.connectedModel')} className="font-mono" />}
                {link1 && <Chip label={t('chat.openWebUi')}><a href={link1} target="_blank" rel="noreferrer" title={t('chat.openWebUi')} className="inline-flex items-center gap-1 rounded-full outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{t('chat.openWebUi')}<OpenWebUiIcon className="size-3" /></a></Chip>}
                {assistant.docUrl && <Chip label={t('chat.documentation')}><a href={assistant.docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{t('chat.documentation')}<ExternalLink aria-hidden className="size-3" /></a></Chip>}
              </div>}
              <p className="mt-1 text-sm text-muted-foreground">{assistant.summary}</p>
              {owner && <span className="mt-2 inline-flex items-center gap-1 text-xs"><UserAvatar user={owner} size="xs" />{owner.name}</span>}
            </div>
          </div>
          {(assistant.expectedInputs.length > 0 || assistant.expectedOutputs.length > 0) && <div className="flex flex-wrap items-center gap-1.5 rounded-xl border bg-muted/30 p-3 text-xs">
            {assistant.expectedInputs.map((item) => <span key={item} className="rounded-full border bg-background px-2 py-0.5">{item}</span>)}
            {assistant.expectedInputs.length > 0 && assistant.expectedOutputs.length > 0 && <ArrowRight className="size-3.5 text-muted-foreground" />}
            {assistant.expectedOutputs.map((item) => <span key={item} className="rounded-full border bg-tone-violet-bg px-2 py-0.5 text-tone-violet-fg">{item}</span>)}
          </div>}
          <div className="space-y-1.5"><div className="text-xs font-medium">{t('hub.tags')}</div>
            <TagInput tags={tags} suggest={suggest} srStatus={srStatus} onAdd={(value) => setTags((current) => current.some((item) => tagKey(item) === tagKey(value)) ? current : [...current, value])} onRemove={(value) => setTags((current) => current.filter((item) => item !== value))} placeholder={t('hub.tagPlaceholder')} />
            {/* 첫 전송 전에도 이 태그를 쓰는 대화를 미리 본다 — 조회만, 저장 없음 */}
            <RelatedStrip tags={tags} />
          </div>
          {refId && <div className="rounded-xl border border-tone-warning-fg/40 bg-tone-warning-bg p-3 text-xs">{t('chat.referenceConversation')}</div>}
          {waitingSince !== undefined && <ChatMessages messages={[]} waitingSince={waitingSince} assistantName={assistant.name} />}
          {retired && <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{t('hub.retiredAssistant')} <Link to="/" className="underline">{t('hub.pickAnotherAssistant')}</Link></div>}
        </div>
      </div>
      {!retired && <div className="mx-auto w-full max-w-2xl"><Composer ref={composer} clearOnSubmit disabled={busy} streaming={false} allowAttachments allowDiscussion placeholder={t('chat.composerPlaceholderFor', { assistant: assistant.name })} onSend={send} onStop={() => undefined} suggestions={suggestionsFrom(assistant.usageExample, assistant.suggestedQuestions)} /></div>}
    </FileDropZone>
  </>
}
