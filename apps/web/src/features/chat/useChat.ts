import { stepProjection, type AnswerStep, type Message } from '@mes/domain'
import { useAnswerDetail } from './useAnswerDetail'
import { newId } from '@/lib/ids'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RequestHttpError, cancelRequest, getRequest, isTerminalRequest, streamRequest } from '@/api/requests'
import { useSlowRequestBubble } from '@/features/assistant-pill/bubbles'
import { rememberMyRequest } from '@/features/assistant-pill/replyBubble'
import { getDraft, setDraft, type ComposerDraft } from './drafts'
import { useT } from '@/i18n'

/** firstTokenMs·idleMs·maxMs: 서버가 알린 이 요청의 첫 응답·무응답·최대 처리 제한(ms) */
export interface ChatRun { requestId: string; replyId: string; text: string; reasoning?: string; steps?: AnswerStep[]; phase?: string; startedAt?: number; firstTokenMs?: number; idleMs?: number; maxMs?: number }
/** 실행 중 이만큼 응답 스트림 이벤트가 없으면 서버 요청 상태를 직접 확인한다 — 프록시가 SSE를 붙잡거나 조용히 끊어도 끝을 놓치지 않게 */
export const STATUS_CHECK_MS = 5_000
interface Attempt { key: string; threadId: string; requestId?: string; startedAt?: number; text: string; attachmentIds: string[]; path: string; body: unknown; autoStartNotified?: boolean; detailCaptured?: boolean }
interface FirstDraft { taskId: string; draft: ComposerDraft }
const firstDrafts = new Map<string, FirstDraft>()
const storageKey = (threadId: string) => `mes-chat-attempt:${threadId}`
const load = (threadId: string): Attempt | null => {
  try {
    const raw = sessionStorage.getItem(storageKey(threadId))
    const attempt = raw ? JSON.parse(raw) as Attempt : null
    return attempt?.threadId === threadId && attempt.key && attempt.path ? attempt : null
  } catch { return null }
}
const save = (attempt: Attempt) => sessionStorage.setItem(storageKey(attempt.threadId), JSON.stringify(attempt))
const clear = (attempt: Attempt) => sessionStorage.removeItem(storageKey(attempt.threadId))

export function queueFirstRequest(threadId: string, body: { content: string; attachmentIds: string[]; oneShotFileIds: string[] }, startedAt = Date.now(), restore?: FirstDraft) {
  const attempt = load(threadId) ?? { key: newId(), threadId, startedAt, text: body.content, attachmentIds: body.attachmentIds,
    path: `/threads/${encodeURIComponent(threadId)}/requests`, body }
  save(attempt)
  if (restore) firstDrafts.set(threadId, restore)
  else firstDrafts.delete(threadId)
}

export function useChat(threadId?: string, onAutoStarted?: () => void, onFirstFailure?: (draft: ComposerDraft, error: unknown) => void, onStarted?: () => void) {
  const t = useT()
  const { detail } = useAnswerDetail()
  const detailRef = useRef(detail)
  detailRef.current = detail
  const query = useQueryClient()
  const autoStarted = useRef(onAutoStarted)
  autoStarted.current = onAutoStarted
  const started = useRef(onStarted)
  started.current = onStarted
  const firstFailure = useRef(onFirstFailure)
  firstFailure.current = onFirstFailure
  const [run, setRun] = useState<ChatRun | null>(null)
  const runRef = useRef(run)
  runRef.current = run
  useSlowRequestBubble(run) // 도우미 말풍선(U6) — 마지막 본문·생각 delta 뒤 30초 무진행이면 요청당 1회
  /** 전송 시도가 진행 중(started 이전 대기 포함)인지. run은 started 이후에만 채워진다. */
  const [waitingSince, setWaitingSince] = useState<number | undefined>(() => threadId ? load(threadId)?.startedAt : undefined)
  const [sending, setSending] = useState(false)
  const active = useRef<Promise<void> | null>(null)
  /** 진행 중 소비를 이 화면에서 떼어 낸다(스트림·확인 타이머·리스너 정리). 서버 요청은 계속되고 시도는 남아 다시 마운트되면 같은 키로 이어 붙는다 */
  const detach = useRef<(() => void) | null>(null)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const consume = useCallback((attempt: Attempt): Promise<void> => {
    if (active.current) return active.current
    // 내려간 화면에서 늦게 시작된 전송(업로드·추정 대기 뒤)은 붙지 않는다 — 시도는 저장돼 있어 다시 열면 이어 붙는다
    if (!mounted.current) { save(attempt); return Promise.resolve() }
    const work = (async () => {
      let terminal = false
      let failed: string | undefined
      let detached = false
      let stream: AbortController | undefined
      detach.current = () => { detached = true; stream?.abort() }
      attempt.startedAt ??= Date.now()
      save(attempt)
      setWaitingSince(attempt.startedAt)
      setSending(true)
      try {
        for (let number = 0; number < 2 && !terminal && !detached; number++) {
          const controller = new AbortController()
          stream = controller
          let lastEventAt = Date.now(), checking: Promise<void> | undefined
          // 서버 기록이 끝 상태면 그것으로 끝낸다(멈춘 스트림은 중단). 아직 진행 중이면 단계만 맞춘다
          const settle = (): Promise<void> => {
            const requestId = attempt.requestId
            if (!requestId || terminal) return Promise.resolve()
            return checking ??= (async () => { try {
              const record = await getRequest(requestId)
              if (terminal) return
              if (isTerminalRequest(record.status)) {
                terminal = true
                if (record.status !== 'succeeded') failed = record.error ?? record.status
                controller.abort()
              } else if (record.phase) setRun((current) => current && current.requestId === record.id && current.phase !== record.phase ? { ...current, phase: record.phase! } : current)
            } catch { /* 다음 확인 때 다시 */ } finally { lastEventAt = Date.now(); checking = undefined } })()
          }
          const tick = setInterval(() => { if (Date.now() - lastEventAt >= STATUS_CHECK_MS) void settle() }, 1_000)
          const wake = () => { if (document.visibilityState !== 'hidden') void settle() }
          window.addEventListener('focus', wake)
          document.addEventListener('visibilitychange', wake)
          try {
            if (!attempt.requestId && !attempt.detailCaptured) {
              if (detailRef.current !== 'brief') attempt.body = { ...(attempt.body as object), detail: detailRef.current }
              attempt.detailCaptured = true
              save(attempt)
            }
            await streamRequest(attempt.path, attempt.body, (event, data) => {
              if (detached) return
              lastEventAt = Date.now()
              if (event === 'started') {
                started.current?.()
                // 재시도는 처음부터 requestId가 있으므로 요청 ID가 아니라 시도별 표시로 알림 중복(재연결 재생)을 막는다
                const notify = data.autoStarted === true && !attempt.autoStartNotified
                if (notify) attempt.autoStartNotified = true
                attempt.requestId = String(data.requestId)
                save(attempt)
                rememberMyRequest(attempt.requestId) // 다른 창·탭의 도우미가 이 요청의 끝을 알린다(replyBubble)
                if (notify) autoStarted.current?.()
                setRun({ requestId: attempt.requestId, replyId: String(data.replyMessageId), text: String(data.resumedText ?? ''), reasoning: String(data.resumedReasoning ?? ''), steps: Array.isArray(data.resumedSteps) ? data.resumedSteps as AnswerStep[] : undefined,
                  startedAt: typeof data.createdAt === 'string' ? Date.parse(data.createdAt) : attempt.startedAt,
                  firstTokenMs: typeof data.firstTokenMs === 'number' ? data.firstTokenMs : undefined, idleMs: typeof data.idleMs === 'number' ? data.idleMs : undefined,
                  maxMs: typeof data.maxMs === 'number' ? data.maxMs : undefined })
                void query.invalidateQueries({ queryKey: ['messages', attempt.threadId] })
              } else if (event === 'phase') {
                setRun((current) => current ? { ...current, phase: String(data.text) } : current)
              } else if ((event === 'delta' || event === 'reasoning') && typeof data.stepIndex === 'number' && data.step) {
                setRun(current => {
                  if (!current) return current
                  const steps = [...(current.steps ?? [])]
                  steps[data.stepIndex as number] = data.step as AnswerStep
                  if (typeof data.stepCount === 'number' && data.stepCount < steps.length) steps.length = data.stepCount
                  const projection = stepProjection(steps)
                  return { ...current, steps, text: projection.content, reasoning: projection.reasoning,
                    phase: (data.step as AnswerStep).type === 'reasoning' ? '생각 중' : (data.step as AnswerStep).type === 'text' ? '답변 중' : current.phase }
                })
              } else if ((event === 'delta' || event === 'reasoning') && typeof data.stepIndex === 'number') {
                // 단계에 붙는 조각 — 서버는 자라는 글 단계의 늘어난 부분만 보낸다
                const index = data.stepIndex
                const type = event === 'delta' ? 'text' : 'reasoning'
                const piece = String(data.text)
                setRun(current => {
                  if (!current) return current
                  const steps = [...(current.steps ?? [])]
                  const prev = steps[index]
                  steps[index] = { type, text: (prev?.type === type ? prev.text : '') + piece }
                  const phase = type === 'reasoning' ? '생각 중' : '답변 중'
                  // 그 종류의 마지막 단계에 붙으면 호환 필드도 이어 붙이고(토큰마다 전체를 다시 잇지 않게), 아니면 다시 만든다
                  if (prev?.type === type && !steps.slice(index + 1).some(step => step.type === type)) {
                    return type === 'text' ? { ...current, steps, text: current.text + piece, phase } : { ...current, steps, reasoning: (current.reasoning ?? '') + piece, phase }
                  }
                  const projection = stepProjection(steps)
                  return { ...current, steps, text: projection.content, reasoning: projection.reasoning, phase }
                })
              } else if (event === 'reasoning') {
                setRun((current) => current ? { ...current, reasoning: (current.reasoning ?? '') + String(data.text), phase: '생각 중' } : current)
              } else if (event === 'delta') {
                setRun((current) => current ? { ...current, text: current.text + String(data.text), phase: '답변 중' } : current)
              } else if (event === 'replace') {
                // OpenWebUI 세션 모드 — 누적 본문·생각이 이어지지 않으면 서버가 전체를 다시 보낸다
                setRun((current) => current ? data.field === 'reasoning' ? { ...current, reasoning: String(data.text), phase: '생각 중' }
                  : { ...current, text: String(data.text), steps: Array.isArray(data.steps) ? data.steps as AnswerStep[] : current.steps, phase: '답변 중' } : current)
              } else if (event === 'failed') {
                failed = String(data.error)
                terminal = true
              } else if (event === 'completed') terminal = true
            }, attempt.key, controller.signal)
            if (detached) break
            // 끝 이벤트 없이 닫혔다 — 서버가 이미 끝냈을 수 있으니 다시 붙기 전에 묻는다
            if (!terminal) await settle()
            if (!terminal) throw new Error(t('chat.streamDisconnected'))
          } catch (error) {
            if (error instanceof RequestHttpError && error.status === 409 && error.code === 'INPUT_SELECTION_CHANGED') {
              terminal = true // 서버가 생성 전에 거부했으므로 이 시도는 재생하지 않는다.
              void query.invalidateQueries({ queryKey: ['estimate', attempt.threadId] })
              throw new Error(t('task.materials.selectionChanged'))
            }
            if (detached) break
            if (!terminal) await settle()
            // 끝이 확인됐으면(이벤트·상태 확인) 스트림 오류는 무시한다 — 실패는 아래에서 failed로 알린다
            if (!terminal && number === 1) throw error
          } finally {
            clearInterval(tick)
            window.removeEventListener('focus', wake)
            document.removeEventListener('visibilitychange', wake)
          }
        }
        if (failed && !detached) throw new Error(failed)
      } finally {
        if (terminal) clear(attempt)
        // 캐시에는 스트리밍 중에 읽은 진행 중 사본이 남아 있을 수 있다(실시간 이벤트마다 다시 읽음) — 그러면 run을 내리는 순간
        // 그 사본이 '다른 곳의 진행 중 요청'으로 다시 그려진다(앞 단계가 옛 글로 덮임). 성공으로 끝났으면 받은 마지막 단계로 그 사본을 끝 상태로 맞춘다
        const finished = runRef.current
        if (!detached && terminal && !failed && finished && finished.requestId === attempt.requestId) {
          query.setQueryData<Message[]>(['messages', attempt.threadId], rows => rows?.map(row => row.id === finished.replyId && row.status === 'streaming'
            ? { ...row, status: 'done', content: finished.text || row.content, reasoning: finished.reasoning || row.reasoning, steps: finished.steps ?? row.steps } : row))
        }
        // 떼어 낸 소비는 화면 상태를 건드리지 않는다 — 같은 인스턴스가 다시 붙었을 수 있다(StrictMode)
        if (!detached) {
          setRun(null)
          setSending(false)
          setWaitingSince(undefined)
        }
        if (!detached || terminal) {
          await query.cancelQueries({ queryKey: ['messages', attempt.threadId] })
          await query.invalidateQueries({ queryKey: ['messages', attempt.threadId] })
          await query.invalidateQueries({ queryKey: ['activity'] })
          // 사용 기록(chat_request_input)은 전달 단계에서 쌓인다 — 끝난 뒤 자료함의 사용됨·첨부됨을 다시 읽는다(완료 SSE는 이 목록을 건드리지 않는다)
          for (const key of ['candidate-count', 'candidates', 'sr-inputs', 'conversation-inputs']) void query.invalidateQueries({ queryKey: [key] })
        }
      }
    })()
    active.current = work
    void work.finally(() => { if (active.current === work) { active.current = null; detach.current = null } }).catch(() => undefined)
    return work
  }, [query, t])

  useEffect(() => {
    if (!threadId) return
    let mounted = true
    const previous = load(threadId)
    const restore = firstDrafts.get(threadId)
    if (previous) void consume(previous).then(() => {
      if (mounted && firstDrafts.get(threadId) === restore) firstDrafts.delete(threadId)
    }).catch(error => {
      if (!mounted || !restore || firstDrafts.get(threadId) !== restore) return
      firstDrafts.delete(threadId)
      const current = getDraft(restore.taskId)
      const draft: ComposerDraft = {
        text: current?.text || restore.draft.text,
        pending: [...restore.draft.pending.filter(item => !current?.pending.includes(item)), ...(current?.pending ?? [])],
        discussion: current?.discussion ?? restore.draft.discussion,
      }
      setDraft(restore.taskId, draft)
      firstFailure.current?.(draft, error)
    })
    // 화면이 내려가면(탭 LRU 퇴거·언마운트) 진행 중 소비를 떼어 낸다 — 남은 시도는 다시 열 때 위에서 이어 붙는다(같은 시도를 둘이 소비하지 않게)
    return () => {
      mounted = false
      detach.current?.()
      detach.current = null
      active.current = null
    }
  }, [consume, threadId])

  return {
    run,
    sending,
    waitingSince,
    hasPendingAttempt: () => !!(threadId && load(threadId)),
    /** 보관된(전송하지 못한) 시도의 내용 — 다음 전송이 이것을 그대로 다시 보낸다 */
    pendingAttempt: (): { text: string; attachmentIds: string[] } | null => { const attempt = threadId ? load(threadId) : null; return attempt && { text: attempt.text, attachmentIds: attempt.attachmentIds } },
    send: (content: string, attachmentIds: string[] = [], oneShotFileIds: string[] = [], startedAt = Date.now(), inputSignature?: string) => {
      if (!threadId) throw new Error(t('chat.noThread'))
      const attempt = load(threadId) ?? { key: newId(), threadId, startedAt, text: content, attachmentIds,
        path: `/threads/${encodeURIComponent(threadId)}/requests`, detailCaptured: true, body: { content, attachmentIds, oneShotFileIds, ...(inputSignature ? { inputSignature } : {}), ...(detail !== 'brief' ? { detail } : {}) } }
      save(attempt)
      return consume(attempt)
    },
    retry: (requestId: string, options: { excludeFileIds?: string[]; forceInlineFileIds?: string[] } = {}) => {
      if (!threadId) throw new Error(t('chat.noThread'))
      const attempt = load(threadId) ?? { key: newId(), threadId, requestId, text: '', attachmentIds: [],
        path: `/requests/${encodeURIComponent(requestId)}/retry`, detailCaptured: true, body: { ...options, ...(detail !== 'brief' ? { detail } : {}) } }
      save(attempt)
      return consume(attempt)
    },
    stop: async (requestId?: string) => { const id = requestId ?? run?.requestId; if (id) await cancelRequest(id) },
  }
}
