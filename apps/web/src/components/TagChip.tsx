import { isSrTag, srTagColor } from '@mes/domain'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { Chip } from './Chip'

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
  const t = useT()
  const color = srTagColor(tag)
  const sr = isSrTag(tag)
  const body = (
    <>
      {sr ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} /> : <span className="text-muted-foreground">#</span>}
      <span className={cn('truncate', sr && 'font-mono')}>{tag}</span>
    </>
  )
  return (
    <Chip
      label={tag}
      variant="tag"
      size={size}
      className={className}
      style={color ? { borderColor: color } : undefined}
      title={t('components.viewTag', { value: tag })}
      onClick={onClick ? () => onClick(tag) : undefined}
      onRemove={onRemove ? () => onRemove(tag) : undefined}
      removeLabel={t('components.removeTag', { value: tag })}
    >
      {body}
    </Chip>
  )
}
