import { useAnswerDetail } from './useAnswerDetail'
import { useEffect, useId, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Message } from '@mes/domain'
import { AlertCircle, ArrowDown, List, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDates } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { MessageBubble } from './MessageBubble'
import type { ChatRun } from './useChat'
import { isFileProgress, isOwuiWorking, requestPhaseDetail } from './requestLabels'
import { MAX_LIMIT_MS, QUIET_AFTER_MS, RESPONSE_LIMIT_MS, STALLED_AFTER_MS } from './streamProgress'

type BubbleActions = Omit<ComponentProps<typeof MessageBubble>, 'message' | 'progress'>
const nearBottomDistance = 24
const jumpDistance = 200
const toolButton = 'relative inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground after:absolute after:-inset-1.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

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

/**
 * 업무와 SR 접수에서 공용 메시지 표시·스트리밍·자동 스크롤을 사용한다.
 * 검색 토글·질문 목차 아이콘은 questionIndexContainer로, 펼친 검색 줄은 searchContainer로 포털한다(없으면 메시지 위에 그대로).
 */
export function ChatMessages({ messages, run, waitingSince, empty, actions, questionIndexContainer, searchContainer, assistantName, intake = false }: {
  intake?: boolean
  assistantName?: string; messages: Message[]; run?: ChatRun | null; waitingSince?: number; empty?: ReactNode; actions?: (message: Message) => BubbleActions
  questionIndexContainer?: HTMLElement | null; searchContainer?: HTMLElement | null
}) {
  const t = useT()
  const { detail, toggle } = useAnswerDetail(intake ? 'sr' : undefined)
  const detailGuideId = useId()
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
  const currentReasoning = run?.reasoning || currentReply?.reasoning
  // 단계: 서버가 알린 진행(파일·도구 — 예: URL 읽는 중)이 있으면 그것, 아니면 답변 작성 중 > 생각 중 > 대기 중
  const phase = requestPhaseDetail(run?.phase, t) ?? (currentText?.trim() ? t('chat.answering') : currentReasoning?.trim() ? t('chat.thinking') : t('chat.waiting'))
  // 마지막 신호(본문·생각·단계 변화) 시각 — 요청마다(시작 시각) 새로 센다
  const signature = `${currentText ?? ''}\u0000${currentReasoning ?? ''}\u0000${run?.phase ?? ''}`
  // 서버는 본문·생각·도구 상태가 올 때만 무응답 제한을 다시 건다(파일 진행은 아님) — 그 전에는 요청 생성부터 첫 응답 제한
  const armedSignature = `${currentText ?? ''}\u0000${currentReasoning ?? ''}\u0000${isFileProgress(run?.phase) ? '' : run?.phase ?? ''}`
  // 본문만 따로 — 마지막으로 글이 자란 시각(답 아래 진행 상태를 보일지)
  const text = currentText ?? ''
  const lastSignal = useRef<{ startedAt?: number; signature: string; armedSignature: string; at?: number; armedAt?: number; text: string; textAt?: number }>({ startedAt, signature, armedSignature, text })
  if (lastSignal.current.startedAt !== startedAt) lastSignal.current = { startedAt, signature, armedSignature, text }
  else if (lastSignal.current.signature !== signature) {
    const at = Date.now()
    lastSignal.current = { ...lastSignal.current, signature, armedSignature, at, armedAt: lastSignal.current.armedSignature !== armedSignature ? at : lastSignal.current.armedAt,
      text, textAt: lastSignal.current.text !== text ? at : lastSignal.current.textAt }
  }
  const signalAt = lastSignal.current.at, armedAt = lastSignal.current.armedAt
  const silentSince = Math.max(signalAt ?? 0, startedAt ?? now)
  const quiet = now - silentSince >= QUIET_AFTER_MS
  // OpenWebUI 작업 목록이 살아 있으면(세션 모드) 서버가 무응답 제한을 다시 건다 — 남은 시간은 최대 처리 시간 기준
  const working = isOwuiWorking(run?.phase)
  // 글이 있는데 한동안 그대로면 답 아래에도 진행 상태를 보인다(아직 끝나지 않았다)
  const stalled = !!text.trim() && now - (lastSignal.current.textAt ?? startedAt ?? now) >= STALLED_AFTER_MS
  // 서버가 알린 이 요청의 제한을 쓰고, 없으면(옛 서버) 기본값으로 어림한다
  const limitAt = working ? (run?.startedAt ?? startedAt ?? now) + (run?.maxMs ?? MAX_LIMIT_MS)
    : armedAt !== undefined ? armedAt + (run?.idleMs ?? RESPONSE_LIMIT_MS) : (run?.startedAt ?? startedAt ?? now) + (run?.firstTokenMs ?? RESPONSE_LIMIT_MS)
  const limitLeft = Math.max(0, Math.ceil((limitAt - now) / 1000))
  const lastSignalSeconds = signalAt === undefined ? undefined : Math.max(0, Math.floor((now - signalAt) / 1000))
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
  const [searchOpen, setSearchOpen] = useState(false)
  const searchToggle = useRef<HTMLButtonElement>(null)
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
  // 타자 표시처럼 상태 변화 없이 자라는 내용도 바닥에 있을 때만 따라간다(위로 올려 읽는 중이면 멈춘다)
  useEffect(() => {
    const element = root.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { if (nearBottom.current) bottom.current?.scrollIntoView?.({ block: 'end', behavior: 'instant' }) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

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
  function closeSearch() {
    setSearch(''); setMatchIndex(0); setSearchOpen(false)
    searchToggle.current?.focus()
  }
  const searchBar = searchOpen && <div role="search" aria-label={t('chat.searchConversation')} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        <input autoFocus type="search" aria-label={t('chat.searchConversation')} placeholder={t('chat.searchConversation')}
          value={search} onChange={event => { setSearch(event.target.value); setMatchIndex(0) }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') { event.preventDefault(); nextMatch(event.shiftKey ? -1 : 1) }
            if (event.key === 'Escape') closeSearch()
          }} className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        {search.trim() && <><span role="status" className="text-xs text-muted-foreground">{t('chat.searchCount', { current: selectedMatch ? Math.min(matchIndex + 1, matches.length) : 0, total: matches.length })}</span>
          <button type="button" disabled={!matches.length} onClick={() => nextMatch(-1)} className="min-h-11 px-2 text-xs disabled:opacity-50">{t('chat.searchPrevious')}</button>
          <button type="button" disabled={!matches.length} onClick={() => nextMatch(1)} className="min-h-11 px-2 text-xs disabled:opacity-50">{t('chat.searchNext')}</button></>}
      </div>
  const tools = <>
      {/* 보이는 문구(현재 모드)가 이름이다 — 무엇이 숨고 담기는지는 설명으로 따로 읽힌다 */}
      <button type="button" data-testid="answer-detail-toggle" onClick={toggle} title={t('chat.answerDetailGuide')} data-answer-detail={detail} aria-describedby={detailGuideId}
        className="min-h-11 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t(detail === 'full' ? 'chat.detailFull' : detail === 'brief' ? 'chat.detailBrief' : 'chat.detailAnswer')}</button>
      <span id={detailGuideId} hidden>{t('chat.answerDetailGuide')}</span>
      <button ref={searchToggle} type="button" data-tour="chat-search" aria-label={t('chat.searchConversation')} title={t('chat.searchConversation')} aria-expanded={searchOpen}
        onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))} className={cn(toolButton, searchOpen && 'bg-muted text-foreground')}><Search aria-hidden="true" className="size-4" /></button>
      {questions.length > 0 && <Popover open={indexOpen} onOpenChange={setIndexOpen}><PopoverTrigger asChild>
        <button type="button" data-tour="chat-toc" aria-label={t('chat.questionIndex')} title={t('chat.questionIndex')} className={toolButton}><List aria-hidden="true" className="size-4" /></button>
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
    </>
  const inline = <>{searchBar}{tools}</>
  return <div ref={root} className="space-y-4">
    {!questionIndexContainer ? <div className="flex flex-wrap items-center justify-end gap-2">{inline}</div>
      : !searchContainer || searchContainer === questionIndexContainer ? createPortal(inline, questionIndexContainer)
      : <>{createPortal(tools, questionIndexContainer)}{searchBar && createPortal(searchBar, searchContainer)}</>}
    {visibleMessages.length ? visibleMessages.map(item => <MessageBubble key={item.id} intake={intake} assistantName={assistantName} searchMatch={item.id === selectedMatch}
      message={run?.replyId === item.id ? { ...item, status: 'streaming', content: run.text || item.content, reasoning: run.reasoning || item.reasoning, steps: run.steps ?? item.steps } : item}
      {...(item === currentReply || item.id !== replyId ? actions?.(item) : undefined)}
      onChoose={!active && item === visibleMessages.at(-1) ? actions?.(item).onChoose : undefined}
      progress={active && item.id === replyId ? { phase, elapsed, lastSignal: lastSignalSeconds, quiet, limitLeft: quiet ? limitLeft : undefined, working, stalled } : undefined} />) : empty}
    {farFromBottom && <div className="sticky bottom-2 flex justify-center"><button type="button" onClick={jumpToEnd}
      className="inline-flex min-h-11 items-center gap-1 rounded-full border bg-card px-3 text-sm text-card-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowDown aria-hidden="true" className="size-4" />{t('chat.scrollToBottom')}</button></div>}
    <div ref={bottom} />
  </div>
}
