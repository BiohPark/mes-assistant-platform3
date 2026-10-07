import { newId } from '@/lib/ids'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { ArrowRight, Bot, Check, Sparkles, Trash2, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/Markdown'
import { Composer } from '@/features/chat/Composer'
import { useActor } from '@/app/hooks'
import { useUiStore } from '@/app/uiStore'
import { getSystemModel, sendSystemMessage, type SystemMessage } from '@/api/systemAssistant'
import { cn } from '@/lib/utils'
import { applyProposal, toProposal, type ProposedAction } from './actions'

interface LocalMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  proposals?: Array<ProposedAction & { ignored?: boolean }>
  waiting?: boolean
}

const EXAMPLES = ['FDS 작성 도우미로 "알람 필터 FDS" 대화 시작해줘 SR-2026-0002', '에이전트 등록: ID label-check, 이름 라벨 검증 도우미, Record › 라벨', 'WK-2026-0009 에 #release-2026-10 태그 붙여줘', 'WK-2026-0006 에 SR-2026-0001 태그 붙여줘']

/** 도구 호출은 제안으로만 표시한다. 적용 버튼을 누른 경우에만 기존 API를 호출한다. */
export function SystemAssistantDrawer() {
  const open = useUiStore((state) => state.assistantOpen)
  const setOpen = useUiStore((state) => state.setAssistantOpen)
  const actor = useActor()
  const navigate = useNavigate()
  const model = useQuery({ queryKey: ['system-assistant', 'model'], queryFn: getSystemModel, enabled: open })
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [waiting, setWaiting] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages])
  useEffect(() => { if (!open) abortRef.current?.abort() }, [open])
  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open, setOpen])

  async function send(text: string) {
    if (waiting || !text.trim()) return
    const user: LocalMessage = { id: newId(), role: 'user', content: text.trim() }
    const botId = newId()
    setMessages((current) => [...current, user, { id: botId, role: 'assistant', content: '', waiting: true }])
    setWaiting(true)
    const controller = new AbortController()
    abortRef.current = controller
    const history: SystemMessage[] = [...messages, user].map(({ role, content }) => ({ role, content }))
    try {
      const reply = await sendSystemMessage(history, controller.signal)
      setMessages((current) => current.map((item) => item.id === botId ? { ...item, content: reply.text, proposals: reply.toolCalls.map(toProposal), waiting: false } : item))
    } catch (error) {
      const message = controller.signal.aborted ? '요청을 중지했습니다.' : error instanceof Error ? error.message : '응답 실패'
      setMessages((current) => current.map((item) => item.id === botId ? { ...item, content: `⚠️ ${message}`, waiting: false } : item))
    } finally {
      abortRef.current = null
      setWaiting(false)
    }
  }

  async function apply(messageId: string, proposal: ProposedAction) {
    if (applying) return
    setApplying(proposal.id)
    try {
      const result = await applyProposal(actor, proposal)
      setMessages((current) => current.map((item) => item.id === messageId ? { ...item, proposals: item.proposals?.map((entry) => entry.id === proposal.id ? { ...entry, applied: result } : entry) } : item))
    } finally { setApplying(null) }
  }

  if (!open) return null
  return <div className="fixed inset-0 z-50 bg-black/30" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
    <aside role="dialog" aria-modal="true" aria-label="시스템 assistant" className="ml-auto flex h-full w-full flex-col bg-background shadow-xl sm:max-w-md">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="size-3.5" /></span>시스템 assistant
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">{model.data ? model.data.mode === 'mock' ? 'Mock (규칙 기반)' : model.data.model : ''}</span>
          <Button variant="ghost" size="icon-sm" aria-label="시스템 assistant 닫기" onClick={() => setOpen(false)}><X /></Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">대화 시작, 에이전트 등록, 태그 연결을 요청하세요. 제안을 확인한 뒤 적용합니다.</p>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <div className="space-y-2"><p className="text-xs text-muted-foreground">예시:</p>{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => void send(example)} className="block w-full rounded-lg border bg-card px-3 py-2 text-left text-xs hover:bg-muted">{example}</button>)}</div>}
        {messages.map((message) => <div key={message.id} className={cn('flex gap-2', message.role === 'user' && 'flex-row-reverse')}>
          {message.role === 'assistant' && <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="size-3.5" /></span>}
          <div className={cn('max-w-[88%] space-y-2', message.role === 'user' && 'text-right')}>
            <div className={cn('inline-block rounded-2xl px-3 py-2 text-left', message.role === 'user' ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm border bg-card')}>
              {message.content ? <Markdown content={message.content} className="text-xs" /> : message.waiting ? <span className="text-xs text-muted-foreground">생각 중…</span> : null}
            </div>
            {message.proposals?.map((proposal) => <div key={proposal.id} className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-left">
              <div className="flex items-center gap-1.5 text-[11px] font-medium"><Wrench className="size-3" />{proposal.invalidReason ? '제안 불가' : '제안된 작업'}</div>
              <div className="mt-1 text-xs">{proposal.summary}</div>
              {proposal.invalidReason && <div role="alert" className="mt-1 text-xs text-destructive">{proposal.invalidReason}</div>}
              <details className="mt-1"><summary className="cursor-pointer text-[10px] text-muted-foreground">인자 보기</summary><pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[10px]">{JSON.stringify(proposal.args, null, 2)}</pre></details>
              <div className="mt-2 flex items-center gap-2">
                {proposal.applied ? <><span className={cn('inline-flex items-center gap-1 text-[11px]', proposal.applied.ok ? 'text-emerald-700' : 'text-destructive')}><Check className="size-3" />{proposal.applied.message}</span>{proposal.applied.link && <Button variant="link" size="xs" className="h-auto p-0" onClick={() => { navigate(proposal.applied!.link!); setOpen(false) }}>이동 <ArrowRight /></Button>}</> : proposal.ignored ? <span className="text-xs text-muted-foreground">무시함</span> : <>{!proposal.invalidReason && <Button size="xs" disabled={!!applying} onClick={() => void apply(message.id, proposal)}>적용</Button>}<Button size="xs" variant="ghost" onClick={() => setMessages((current) => current.map((item) => item.id === message.id ? { ...item, proposals: item.proposals?.map((entry) => entry.id === proposal.id ? { ...entry, ignored: true } : entry) } : item))}>무시</Button></>}
              </div>
            </div>)}
          </div>
        </div>)}
      </div>
      {messages.length > 0 && <div className="flex justify-end px-4 pb-1"><Button variant="ghost" size="xs" onClick={() => setMessages([])}><Trash2 />대화 지우기</Button></div>}
      <Composer streaming={waiting} onSend={async (text) => send(text)} onStop={() => abortRef.current?.abort()} placeholder="무엇을 만들까요?" allowAttachments={false} clearOnSubmit />
    </aside>
  </div>
}
