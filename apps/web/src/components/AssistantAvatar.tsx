import { cn } from '@/lib/utils'
import { initialsOf } from '@/lib/colors'
import type { Assistant } from '@mes/contracts'

const SIZE = {
  xs: 'size-6 text-xs rounded-full', sm: 'size-8 text-xs rounded-full', md: 'size-12 text-base rounded-full',
  lg: 'size-20 text-xl rounded-full', xl: 'aspect-square w-full text-4xl rounded-full',
} as const

/** 데모 카드의 이니셜 아바타. 이미지 API는 파일 태스크에서 연결한다. */
export function AssistantAvatar({ assistant, size = 'md', className }: { assistant: Pick<Assistant, 'name' | 'color' | 'imageId'>; size?: keyof typeof SIZE; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white', SIZE[size], className)} style={{ backgroundColor: assistant.color }}>
    {assistant.imageId ? <img src={`/api/files/${encodeURIComponent(assistant.imageId)}/content`} alt="" className="size-full object-cover" /> : initialsOf(assistant.name)}
  </span>
}
