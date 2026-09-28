import { X } from 'lucide-react'
import { isSrTag, srTagColor } from '@mes/domain'
import { cn } from '@/lib/utils'

interface TagChipProps {
  tag: string
  /** 있으면 칩 클릭 시 호출 (예: 해당 태그로 필터된 칸반 이동) */
  onClick?: (tag: string) => void
  onRemove?: (tag: string) => void
  size?: 'xs' | 'sm'
  className?: string
}

/**
 * 태그 칩. 일반 태그는 중립색, SR 태그만 저채도 결정색(점 + 테두리)으로 구분한다.
 * 무지개색을 피하려고 배경은 항상 중립이다.
 */
export function TagChip({ tag, onClick, onRemove, size = 'sm', className }: TagChipProps) {
  const color = srTagColor(tag)
  const sr = isSrTag(tag)
  const body = (
    <>
      {sr ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} /> : <span className="text-muted-foreground">#</span>}
      <span className={cn('truncate', sr && 'font-mono')}>{tag}</span>
    </>
  )
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 text-foreground/80',
        size === 'xs' ? 'h-5 px-1.5 text-[10px]' : 'h-6 px-2 text-[11px]',
        className,
      )}
      style={color ? { borderColor: color } : undefined}
    >
      {onClick ? (
        <button type="button" className="inline-flex min-w-0 items-center gap-1 hover:underline" onClick={() => onClick(tag)} title={`${tag} 태그 대화 보기`}>
          {body}
        </button>
      ) : (
        body
      )}
      {onRemove && (
        <button type="button" aria-label={`${tag} 태그 제거`} className="-mr-0.5 rounded-full text-muted-foreground hover:text-foreground" onClick={() => onRemove(tag)}>
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}
