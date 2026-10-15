import { useT } from '@/i18n'
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { ArrowRight, Bot, Check, Sparkles, Trash2, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Markdown } from '@/components/Markdown'
import { Composer, type ComposerHandle } from '@/features/chat/Composer'
import { useActor } from '@/app/hooks'
import { AssistantMenu } from '@/features/assistant-pill/AssistantMenu'
import { useSearchAgents } from '@/features/assistant-pill/useSearchAgents'
import { getSystemModel } from '@/api/systemAssistant'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/app/uiStore'
import { useSystemAssistantChat, type SystemAssistantChat } from './useSystemAssistantChat'

interface BodyProps { chat: SystemAssistantChat; onClose: () => void; searchAgents: () => void; performPageAction?: (action: () => void) => void }

/** 도우미 창 본문 — 데스크톱 팝오버와 좁은 화면 시트가 같이 쓴다. 도구 호출은 제안으로만 표시하고 적용 버튼을 누른 경우에만 기존 API를 호출한다 */
export function SystemAssistantBody({ chat, onClose, searchAgents, performPageAction }: BodyProps) {
  const t = useT()
  const { userId } = useActor()
  const composer = useRef<ComposerHandle>(null)
  const navigate = useNavigate()
  const model = useQuery({ queryKey: ['system-assistant', 'model'], queryFn: getSystemModel })
  const scrollRef = useRef<HTMLDivElement>(null)
  const { messages, waiting, applying } = chat

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages])

  return <>
    <div className="border-b px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="size-3.5" /></span>{t('systemAssistant.title')}
        <span className="ml-auto text-xs font-normal text-muted-foreground">{model.data ? model.data.mode === 'mock' ? t('systemAssistant.mockMode') : model.data.model : ''}</span>
        <Button variant="ghost" size="icon-sm" aria-label={t('systemAssistant.closeLabel')} onClick={onClose}><X /></Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('systemAssistant.intro')}</p>
    </div>
    <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
      <AssistantMenu userId={userId} searchAgents={searchAgents} prefill={(text) => composer.current?.setText(text)} perform={performPageAction ?? ((action) => { onClose(); requestAnimationFrame(action) })} />
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
              {proposal.applied ? <><span className={cn('inline-flex items-center gap-1 text-xs', proposal.applied.ok ? 'text-tone-success-fg' : 'text-destructive')}><Check className="size-3" />{proposal.applied.message}</span>{proposal.applied.link && <Button variant="link" size="xs" className="h-auto p-0" onClick={() => { navigate(proposal.applied!.link!); onClose() }}>{t('systemAssistant.go')} <ArrowRight /></Button>}</> : proposal.ignored ? <span className="text-xs text-muted-foreground">{t('systemAssistant.ignored')}</span> : <>{!proposal.invalidReason && <Button size="xs" disabled={!!applying} onClick={() => void chat.apply(message.id, proposal)}>{t('systemAssistant.apply')}</Button>}<Button size="xs" variant="ghost" onClick={() => chat.ignore(message.id, proposal.id)}>{t('systemAssistant.ignore')}</Button></>}
            </div>
          </div>)}
        </div>
      </div>)}
    </div>
    {messages.length > 0 && <div className="flex justify-end px-4 pb-1"><Button variant="ghost" size="xs" onClick={chat.clear}><Trash2 />{t('systemAssistant.clear')}</Button></div>}
    <Composer ref={composer} streaming={waiting} onSend={async (text) => chat.send(text)} onStop={chat.stop} placeholder={t('systemAssistant.placeholder')} allowAttachments={false} clearOnSubmit />
  </>
}

/** 좁은 화면(<1024)용 우측 시트. 모달이라 열린 동안 바깥 포커스가 막히므로 닫힘 뒤 포커스 복귀는 returnFocus로 받는다 */
export function SystemAssistantSheet({ open, chat, onClose, returnFocus }: Omit<BodyProps, 'searchAgents'> & { open: boolean; returnFocus: () => void }) {
  const t = useT()
  const pageAction = useRef<(() => void) | null>(null)
  const searchAgents = useSearchAgents()
  return <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
    <SheetContent aria-label={t('systemAssistant.title')} aria-describedby={undefined} showCloseButton={false} className="w-full gap-0 overflow-hidden p-0 sm:max-w-md"
      onCloseAutoFocus={(event) => { event.preventDefault(); const action = pageAction.current; pageAction.current = null; if (action) action(); else returnFocus() }}>
      <SystemAssistantBody chat={chat} onClose={onClose} searchAgents={searchAgents} performPageAction={(action) => { pageAction.current = action; onClose() }} />
    </SheetContent>
  </Sheet>
}

/** 스토어로만 여닫는 단독 시트 — 알약 없이 쓰는 호출자(designTokens 검사) 호환. 앱 셸은 AssistantPill을 쓴다 */
export function SystemAssistantDrawer() {
  const open = useUiStore((state) => state.assistantOpen)
  const setOpen = useUiStore((state) => state.setAssistantOpen)
  const chat = useSystemAssistantChat(open)
  return <SystemAssistantSheet open={open} chat={chat} onClose={() => setOpen(false)} returnFocus={() => undefined} />
}
