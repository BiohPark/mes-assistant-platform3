import { useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n'
import { newId } from '@/lib/ids'
import { useActor } from '@/app/hooks'
import { sendSystemMessage, type SystemMessage } from '@/api/systemAssistant'
import { applyProposal, toProposal, type ProposedAction } from './actions'

export interface LocalMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  proposals?: Array<ProposedAction & { ignored?: boolean }>
  waiting?: boolean
}
export type SystemAssistantChat = ReturnType<typeof useSystemAssistantChat>

/** 도우미 대화 상태 — 창(팝오버·시트)이 닫혀도 이력은 남고, 닫히면 진행 중 요청만 중단한다. 도구 호출은 제안으로만 두고 적용은 사람이 누른다 */
export function useSystemAssistantChat(active: boolean) {
  const t = useT()
  const actor = useActor()
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [waiting, setWaiting] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { if (!active) abortRef.current?.abort() }, [active])
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

  function ignore(messageId: string, proposalId: string) {
    setMessages((current) => current.map((item) => item.id === messageId ? { ...item, proposals: item.proposals?.map((entry) => entry.id === proposalId ? { ...entry, ignored: true } : entry) } : item))
  }

  return { messages, waiting, applying, send, apply, ignore, clear: () => setMessages([]), stop: () => abortRef.current?.abort() }
}
