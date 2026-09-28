import { cn } from '@/lib/utils'
import { initialsOf } from '@/lib/colors'
import type { Assistant } from '@mes/contracts'

const SIZE = {
  xs: 'size-6 text-[10px] rounded-md', sm: 'size-8 text-xs rounded-lg', md: 'size-12 text-base rounded-xl',
  lg: 'size-20 text-xl rounded-2xl', xl: 'aspect-square w-full text-4xl rounded-2xl',
} as const

/** 데모 카드의 이니셜 아바타. 이미지 API는 파일 태스크에서 연결한다. */
export function AssistantAvatar({ assistant, size = 'md', className }: { assistant: Pick<Assistant, 'name' | 'color' | 'imageId'>; size?: keyof typeof SIZE; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center justify-center font-semibold text-white', SIZE[size], className)} style={{ backgroundColor: assistant.color }}>{initialsOf(assistant.name)}</span>
}
