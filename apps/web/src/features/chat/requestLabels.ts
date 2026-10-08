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
