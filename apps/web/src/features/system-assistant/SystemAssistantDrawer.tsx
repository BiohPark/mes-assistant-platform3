import { useT } from '@/i18n'
import { newId } from '@/lib/ids'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { ArrowRight, Bot, Check, Sparkles, Trash2, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
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



/** 도구 호출은 제안으로만 표시한다. 적용 버튼을 누른 경우에만 기존 API를 호출한다. */
export function SystemAssistantDrawer() {
  const t = useT()
  const EXAMPLES = [t('systemAssistant.exampleStart'), t('admin.createAssistantExample'), t('systemAssistant.exampleTagRelease'), t('systemAssistant.exampleTagSr')]
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
  /** 서랍은 SheetTrigger가 아니라 TopBar 버튼(setAssistantOpen)으로 열린다 — 닫힐 때 돌아갈 요소를 직접 기억한다 */
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages])
  useEffect(() => { if (!open) abortRef.current?.abort() }, [open])
  useEffect(() => () => abortRef.current?.abort(), [])

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
      setMessages((current) => current.map((item) => item.id === botId ? { ...item, content: reply.text, proposals: reply.toolCalls.map((call) => toProposal(call, t)), waiting: false } : item))
    } catch (error) {
      const message = controller.signal.aborted ? t('systemAssistant.stopped') : error instanceof Error ? error.message : t('systemAssistant.responseFailed')
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
      const result = await applyProposal(actor, proposal, t)
      setMessages((current) => current.map((item) => item.id === messageId ? { ...item, proposals: item.proposals?.map((entry) => entry.id === proposal.id ? { ...entry, applied: result } : entry) } : item))
    } finally { setApplying(null) }
  }

  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetContent aria-label={t('systemAssistant.title')} aria-describedby={undefined} showCloseButton={false} className="w-full gap-0 overflow-hidden p-0 sm:max-w-md"
      onOpenAutoFocus={() => { openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={(event) => { event.preventDefault(); openerRef.current?.focus(); openerRef.current = null }}>
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="size-3.5" /></span>{t('systemAssistant.title')}
          <span className="ml-auto text-xs font-normal text-muted-foreground">{model.data ? model.data.mode === 'mock' ? t('systemAssistant.mockMode') : model.data.model : ''}</span>
          <Button variant="ghost" size="icon-sm" aria-label={t('systemAssistant.closeLabel')} onClick={() => setOpen(false)}><X /></Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('systemAssistant.intro')}</p>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <div className="space-y-2"><p className="text-xs text-muted-foreground">{t('systemAssistant.examples')}</p>{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => void send(example)} className="block w-full rounded-lg border bg-card px-3 py-2 text-left text-xs hover:bg-muted">{example}</button>)}</div>}
        {messages.map((message) => <div key={message.id} className={cn('flex gap-2', message.role === 'user' && 'flex-row-reverse')}>
          {message.role === 'assistant' && <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="size-3.5" /></span>}
          <div className={cn('max-w-[88%] space-y-2', message.role === 'user' && 'text-right')}>
            <div className={cn('inline-block rounded-2xl px-3 py-2 text-left', message.role === 'user' ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm border bg-card')}>
              {message.content ? <Markdown content={message.content} className="text-xs" /> : message.waiting ? <span className="text-xs text-muted-foreground">{t('systemAssistant.thinking')}</span> : null}
            </div>
            {message.proposals?.map((proposal) => <div key={proposal.id} className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-left">
              <div className="flex items-center gap-1.5 text-xs font-medium"><Wrench className="size-3" />{proposal.invalidReason ? t('systemAssistant.proposalInvalid') : t('systemAssistant.proposal')}</div>
              <div className="mt-1 text-xs">{proposal.summary}</div>
              {proposal.invalidReason && <div role="alert" className="mt-1 text-xs text-destructive">{proposal.invalidReason}</div>}
              <details className="mt-1"><summary className="cursor-pointer text-xs text-muted-foreground">{t('systemAssistant.showArgs')}</summary><pre className="mt-1 max-h-40 overflow-auto rounded-xl bg-muted p-2 text-xs">{JSON.stringify(Object.fromEntries(Object.entries(proposal.args).filter(([key]) => proposal.name !== 'create_assistant' || key !== 'id')), null, 2)}</pre></details>
              <div className="mt-2 flex items-center gap-2">
                {proposal.applied ? <><span className={cn('inline-flex items-center gap-1 text-xs', proposal.applied.ok ? 'text-emerald-700' : 'text-destructive')}><Check className="size-3" />{proposal.applied.message}</span>{proposal.applied.link && <Button variant="link" size="xs" className="h-auto p-0" onClick={() => { navigate(proposal.applied!.link!); setOpen(false) }}>{t('systemAssistant.go')} <ArrowRight /></Button>}</> : proposal.ignored ? <span className="text-xs text-muted-foreground">{t('systemAssistant.ignored')}</span> : <>{!proposal.invalidReason && <Button size="xs" disabled={!!applying} onClick={() => void apply(message.id, proposal)}>{t('systemAssistant.apply')}</Button>}<Button size="xs" variant="ghost" onClick={() => setMessages((current) => current.map((item) => item.id === message.id ? { ...item, proposals: item.proposals?.map((entry) => entry.id === proposal.id ? { ...entry, ignored: true } : entry) } : item))}>{t('systemAssistant.ignore')}</Button></>}
              </div>
            </div>)}
          </div>
        </div>)}
      </div>
      {messages.length > 0 && <div className="flex justify-end px-4 pb-1"><Button variant="ghost" size="xs" onClick={() => setMessages([])}><Trash2 />{t('systemAssistant.clear')}</Button></div>}
      <Composer streaming={waiting} onSend={async (text) => send(text)} onStop={() => abortRef.current?.abort()} placeholder={t('systemAssistant.placeholder')} allowAttachments={false} clearOnSubmit />
    </SheetContent>
  </Sheet>
}
