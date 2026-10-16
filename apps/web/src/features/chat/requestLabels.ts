import type { Translator } from '@/i18n'
import type { ko } from '@/i18n/ko'

type DeliveryKey = `chat.delivery.${keyof typeof ko.chat.delivery}`
type StatusKey = `chat.requestStatus.${keyof typeof ko.chat.requestStatus}`

export const deliveryLabel: Record<string, DeliveryKey> = {
  attached: 'chat.delivery.attached', inline: 'chat.delivery.inline', metadata_only: 'chat.delivery.metadata_only', failed: 'chat.delivery.failed',
}
export const statusLabel: Record<string, StatusKey> = {
  pending: 'chat.requestStatus.pending', streaming: 'chat.requestStatus.streaming', succeeded: 'chat.requestStatus.succeeded',
  failed: 'chat.requestStatus.failed', cancelled: 'chat.requestStatus.cancelled', interrupted: 'chat.requestStatus.interrupted',
}

/** 서버 phase의 언어와 화면 번역을 분리한다. */
export const responsePhase = { thinking: '생각 중', answering: '답변 중' } as const

/** 파일 올리기·처리 대기 진행 — 서버 무응답 제한을 다시 걸지 않는 단계 */
export const isFileProgress = (phase?: string) => !!phase && /^(파일 올리는 중|파일 처리 대기) \d+\/\d+ · /.test(phase)

/** 세션 모드에서 본문이 멈춘 뒤 서버가 알리는 단계(packages/llm openaiProvider의 SESSION_PHASE) */
const sessionPhase = { finishing: '답변 마무리 중', tool: '도구 실행 중: ', code: '코드 실행 중', working: 'OpenWebUI에서 작업 중' } as const
/** OpenWebUI 작업 목록이 살아 있다고 확인된 단계 — 서버는 무응답 제한을 다시 걸고 최대 처리 시간만 남는다 */
export const isOwuiWorking = (phase?: string) => !!phase && (phase === sessionPhase.working || phase.startsWith(`${sessionPhase.working} · `))

export function requestPhaseDetail(phase: string | undefined, t: Translator): string | undefined {
  if (!phase || phase === responsePhase.thinking || phase === responsePhase.answering) return undefined
  if (isOwuiWorking(phase)) {
    const inner = requestPhaseDetail(phase.slice(sessionPhase.working.length + 3), t)
    return inner ? `${t('chat.owuiWorking')} · ${inner}` : t('chat.owuiWorking')
  }
  const page = /^🔗 페이지 읽는 중\((.*)\)$/.exec(phase)
  if (page) return t('chat.readingPage', { host: page[1]! })
  if (phase === sessionPhase.finishing) return t('chat.finishing')
  if (phase === sessionPhase.code) return t('chat.codeRunning')
  if (phase.startsWith(sessionPhase.tool)) return t('chat.toolRunning', { name: phase.slice(sessionPhase.tool.length) })
  const progress = /^(파일 올리는 중|파일 처리 대기) (\d+)\/(\d+) · (.*)$/s.exec(phase)
  if (!progress) return phase
  return t(progress[1] === '파일 올리는 중' ? 'chat.uploadingProgress' : 'chat.processingProgress', {
    index: Number(progress[2]), total: Number(progress[3]), name: progress[4]!,
  })
}
