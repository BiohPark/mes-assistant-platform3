import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { RotateCcw, Send, Square } from 'lucide-react'
import type { LlmTestMessage } from '@mes/contracts'
import { LlmTestError, testChat } from '@/api/llm'
import { useT, type Translator } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

export interface AgentTestChatProps {
  /** 비우면 서버의 기본 모델(.env 유효값)로 보낸다 */
  modelId?: string | null
  showDiagnosticsLink?: boolean
  className?: string
}
type Entry = LlmTestMessage & { model?: string; ms?: number }
/** 시험 API의 메시지 수 한도 — 넘기면 자르지 않고 전송을 막는다 */
const MAX_MESSAGES = 20

function describe(error: unknown, t: Translator): string {
  if (error instanceof LlmTestError) {
    if (error.status === 413) return t('admin.test.errTooLarge')
    if (error.status === 429) return t('admin.test.errBusy')
    if (error.status === 403) return t('admin.test.errForbidden')
    if (error.code === 'TIMEOUT' || error.status === 504) return t('admin.test.errTimeout')
    if (error.code === 'RESPONSE_TOO_LARGE') return t('admin.test.errResponseTooLarge')
    if (error.code === 'MODEL_NOT_FOUND') return t('admin.test.errModelMissing')
  }
  return t('admin.test.errConnection')
}

/** SO 전용 시험 대화 — 업무 맥락 없이 모델에 직접 보낸다. 저장하지 않으며 화면을 떠나면 사라진다. */
export function AgentTestChat({ modelId, showDiagnosticsLink = true, className }: AgentTestChatProps) {
  const t = useT()
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'error' | 'stopped'; text: string } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const model = modelId?.trim() ?? ''
  const full = entries.length >= MAX_MESSAGES
  const canSend = !pending && !!draft.trim() && !full

  async function send() {
    const content = draft.trim()
    if (!canSend) return
    const previous = entries
    const history = [...previous, { role: 'user' as const, content }]
    setEntries(history)
    setDraft('')
    setNotice(null)
    setPending(true)
    const abort = new AbortController()
    controller.current = abort
    try {
      const reply = await testChat({ ...(model ? { model } : {}), messages: history.map(({ role, content: text }) => ({ role, content: text })) }, abort.signal)
      setEntries([...history, { role: 'assistant', content: reply.text, model: reply.model, ms: reply.ms }])
    } catch (error) {
      setEntries(previous)
      setDraft(content)
      setNotice(abort.signal.aborted ? { kind: 'stopped', text: t('admin.test.stopped') } : { kind: 'error', text: describe(error, t) })
    } finally {
      controller.current = null
      setPending(false)
    }
  }
  function reset() {
    setEntries([])
    setDraft('')
    setNotice(null)
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1 text-xs">
        <span className="text-muted-foreground">{t('admin.test.model')}</span>
        {model ? <span className="font-mono">{model}</span> : <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-primary">{t('admin.test.defaultModel')}</span>}
      </div>
      <p className="text-xs text-muted-foreground">{t('admin.test.notice')}</p>
      <ol aria-label={t('admin.test.transcript')} className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-2 text-sm">
        {entries.map((entry, index) => <li key={index} className={cn('rounded-lg px-2 py-1', entry.role === 'user' ? 'bg-primary/10' : 'bg-muted/40')}>
          <div className="text-[11px] text-muted-foreground">{entry.role === 'user' ? t('admin.test.roleUser') : entry.model ? t('admin.test.replyMeta', { model: entry.model, ms: String(entry.ms ?? 0) }) : t('admin.test.roleAssistant')}</div>
          <div className="break-words whitespace-pre-wrap">{entry.content}</div>
        </li>)}
      </ol>
      {pending && <p role="status" className="text-xs text-muted-foreground">{t('admin.test.waiting')}</p>}
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className={cn('text-xs', notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
        {notice.text}
        {notice.kind === 'error' && showDiagnosticsLink && <> <Link to="/admin/diagnostics" className="underline underline-offset-2">{t('admin.diagnostics.open')}</Link></>}
      </p>}
      {full && <p className="text-xs text-muted-foreground">{t('admin.test.limitReached')}</p>}
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <Textarea aria-label={t('admin.test.input')} placeholder={t('admin.test.placeholder')} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={pending} rows={2} className="min-h-10" />
        <div className="flex shrink-0 flex-col gap-1">
          {pending
            ? <Button type="button" variant="outline" size="sm" onClick={() => controller.current?.abort()}><Square />{t('admin.test.stop')}</Button>
            : <Button type="submit" size="sm" disabled={!canSend}><Send />{t('admin.test.send')}</Button>}
          <Button type="button" variant="ghost" size="sm" disabled={pending || (!entries.length && !draft && !notice)} onClick={reset}><RotateCcw />{t('admin.test.reset')}</Button>
        </div>
      </form>
    </div>
  )
}
