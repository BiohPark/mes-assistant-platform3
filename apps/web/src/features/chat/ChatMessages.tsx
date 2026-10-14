import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Message } from '@mes/domain'
import { AlertCircle, ArrowDown, List } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDates } from '@/lib/dates'
import { useT } from '@/i18n'
import { MessageBubble } from './MessageBubble'
import type { ChatRun } from './useChat'
import { requestPhaseDetail } from './requestLabels'

type BubbleActions = Omit<ComponentProps<typeof MessageBubble>, 'message' | 'progress'>
const nearBottomDistance = 24
const jumpDistance = 200

/** 각 질문 뒤·다음 질문 앞 구간에 그 요청의 오류 답변이 있으면 실패로 본다(한 번 순회). */
export function failedQuestionIds(messages: Message[]) {
  const failed = new Set<string>()
  let question: Message | undefined
  for (const item of messages) {
    if (item.role === 'user' && item.kind !== 'discussion') question = item
    else if (question && item.role === 'assistant' && item.status === 'error' && (!question.requestId || item.requestId === question.requestId)) failed.add(question.id)
  }
  return failed
}

/** 업무와 SR 접수에서 공용 메시지 표시·스트리밍·자동 스크롤을 사용한다. */
export function ChatMessages({ messages, run, waitingSince, empty, actions, questionIndexContainer, assistantName }: {
  assistantName?: string; messages: Message[]; run?: ChatRun | null; waitingSince?: number; empty?: ReactNode; actions?: (message: Message) => BubbleActions; questionIndexContainer?: HTMLElement | null
}) {
  const t = useT()
  const { formatDateTime } = useDates()
  const remoteReply = !run ? messages.find(item => item.role === 'assistant' && item.status === 'streaming') : undefined
  const active = !!run || !!remoteReply || waitingSince !== undefined
  const startedAt = waitingSince ?? run?.startedAt ?? (remoteReply ? Date.parse(remoteReply.createdAt) : undefined)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt, active])
  const elapsed = Math.max(0, Math.floor((now - (startedAt ?? now)) / 1000))
  const replyId = run?.replyId ?? remoteReply?.id ?? 'waiting-assistant'
  const currentReply = messages.find(item => item.id === replyId)
  const currentText = run?.text || currentReply?.content
  const phase = currentText?.trim() ? t('chat.answering') : t('chat.thinking')
  const phaseDetail = requestPhaseDetail(run?.phase, t)
  // Show an assistant header before the reply is fetched, then reuse its key.
  const visibleMessages: Message[] = active && !currentReply ? [...messages, {
    id: replyId, threadId: messages.at(-1)?.threadId ?? '', role: 'assistant', status: 'streaming',
    content: run?.text ?? '', reasoning: run?.reasoning, attachmentIds: [], createdAt: new Date(startedAt ?? now).toISOString(),
  }] : messages
  const root = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const nearBottom = useRef(true)
  const [farFromBottom, setFarFromBottom] = useState(false)
  const [search, setSearch] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const matches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return term ? visibleMessages.filter(message => (message.id === run?.replyId ? run.text || message.content : message.content).toLocaleLowerCase().includes(term)) : []
  }, [search, visibleMessages, run?.replyId, run?.text])
  const selectedMatch = matches[Math.min(matchIndex, Math.max(0, matches.length - 1))]?.id
  const [indexOpen, setIndexOpen] = useState(false)
  const jumpTarget = useRef<HTMLElement | null>(null)
  const questions = messages.filter(item => item.role === 'user' && item.kind !== 'discussion')
  const failed = useMemo(() => indexOpen ? failedQuestionIds(messages) : new Set<string>(), [indexOpen, messages])

  // Track the enclosing scroller before content grows, rather than measuring its new height.
  useEffect(() => {
    let scroller = root.current?.parentElement
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    if (!scroller) return
    const element = scroller
    scrollerRef.current = element
    const onScroll = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      nearBottom.current = distance <= nearBottomDistance
      setFarFromBottom(distance > jumpDistance)
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    if (nearBottom.current) bottom.current?.scrollIntoView?.({ block: 'end', behavior: 'instant' })
    const element = scrollerRef.current
    if (element) setFarFromBottom(element.scrollHeight - element.scrollTop - element.clientHeight > jumpDistance)
  }, [messages, run?.text, run?.reasoning, run?.phase, waitingSince])

  function messageElement(id: string) {
    return Array.from(root.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []).find(element => element.dataset.messageId === id)
  }
  function focusMessage(element: HTMLElement) {
    element.scrollIntoView?.({ block: 'start', behavior: 'instant' })
    element.focus({ preventScroll: true })
  }
  function jumpToEnd() {
    nearBottom.current = true
    setFarFromBottom(false)
    bottom.current?.scrollIntoView?.({ block: 'end', behavior: 'instant' })
    const last = messages.at(-1)
    if (last) messageElement(last.id)?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (selectedMatch) messageElement(selectedMatch)?.scrollIntoView?.({ block: 'center', behavior: 'instant' })
  }, [selectedMatch])
  function nextMatch(direction: number) {
    setMatchIndex(current => matches.length ? (current + direction + matches.length) % matches.length : 0)
  }
  const questionIndex = <div className="flex flex-wrap items-center justify-end gap-2">
      <div role="search" aria-label={t('chat.searchConversation')} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        <input type="search" aria-label={t('chat.searchConversation')} placeholder={t('chat.searchConversation')}
          value={search} onChange={event => { setSearch(event.target.value); setMatchIndex(0) }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') { event.preventDefault(); nextMatch(event.shiftKey ? -1 : 1) }
            if (event.key === 'Escape') { setSearch(''); setMatchIndex(0) }
          }} className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        {search.trim() && <><span role="status" className="text-xs text-muted-foreground">{t('chat.searchCount', { current: selectedMatch ? Math.min(matchIndex + 1, matches.length) : 0, total: matches.length })}</span>
          <button type="button" disabled={!matches.length} onClick={() => nextMatch(-1)} className="min-h-11 px-2 text-xs disabled:opacity-50">{t('chat.searchPrevious')}</button>
          <button type="button" disabled={!matches.length} onClick={() => nextMatch(1)} className="min-h-11 px-2 text-xs disabled:opacity-50">{t('chat.searchNext')}</button></>}
      </div>
      {questions.length > 0 && <Popover open={indexOpen} onOpenChange={setIndexOpen}><PopoverTrigger asChild>
        <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-lg border bg-card px-3 text-xs text-card-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><List aria-hidden="true" className="size-4" />{t('chat.questionIndex')}</button>
      </PopoverTrigger><PopoverContent align="end" aria-label={t('chat.questionIndex')} className="max-h-80 overflow-y-auto"
        onCloseAutoFocus={(event) => { if (jumpTarget.current) { event.preventDefault(); focusMessage(jumpTarget.current); jumpTarget.current = null } }}>
        <nav aria-label={t('chat.questionIndex')} className="space-y-1">{questions.map((item, index) => <button key={item.id} type="button"
          className="flex min-h-11 w-full flex-col gap-1 rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => { jumpTarget.current = messageElement(item.id) ?? null; setIndexOpen(false) }}>
          <span className="line-clamp-2 break-all">{index + 1}. {item.content}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
            {failed.has(item.id) && <span className="inline-flex items-center gap-1 text-tone-danger-fg"><AlertCircle aria-hidden="true" className="size-3" />{t('chat.questionFailed')}</span>}</span>
        </button>)}</nav>
      </PopoverContent></Popover>}
    </div>
  return <div ref={root} className="space-y-4">
    {questionIndexContainer ? createPortal(questionIndex, questionIndexContainer) : questionIndex}
    {visibleMessages.length ? visibleMessages.map(item => <MessageBubble key={item.id} assistantName={assistantName} searchMatch={item.id === selectedMatch}
      message={run?.replyId === item.id ? { ...item, status: 'streaming', content: run.text || item.content, reasoning: run.reasoning || item.reasoning } : item}
      {...(item === currentReply || item.id !== replyId ? actions?.(item) : undefined)}
      progress={active && item.id === replyId ? { phase, elapsed, detail: phaseDetail } : undefined} />) : empty}
    {farFromBottom && <div className="sticky bottom-2 flex justify-center"><button type="button" onClick={jumpToEnd}
      className="inline-flex min-h-11 items-center gap-1 rounded-full border bg-card px-3 text-sm text-card-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowDown aria-hidden="true" className="size-4" />{t('chat.scrollToBottom')}</button></div>}
    <div ref={bottom} />
  </div>
}
