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

export function requestPhaseDetail(phase: string | undefined, t: Translator): string | undefined {
  if (!phase || phase === responsePhase.thinking || phase === responsePhase.answering) return undefined
  const progress = /^(파일 올리는 중|파일 처리 대기) (\d+)\/(\d+) · (.*)$/s.exec(phase)
  if (!progress) return phase
  return t(progress[1] === '파일 올리는 중' ? 'chat.uploadingProgress' : 'chat.processingProgress', {
    index: Number(progress[2]), total: Number(progress[3]), name: progress[4]!,
  })
}
