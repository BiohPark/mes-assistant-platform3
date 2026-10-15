import { isSrTag, srTagColor } from '@mes/domain'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { Chip } from './Chip'

interface TagChipProps {
  tag: string
  /** 있으면 칩 클릭 시 호출 (예: 해당 태그로 필터된 칸반 이동) */
  onClick?: (tag: string) => void
  /** 있으면 SR 번호 태그는 onClick 대신 이것을 부른다(SR 상세 원클릭, S14). 일반 태그는 그대로 onClick */
  onSrClick?: (code: string) => void
  onRemove?: (tag: string) => void
  size?: 'xs' | 'sm'
  className?: string
  /** 태그 뒤에 붙는 짧은 보조 표기 (예: 'SR 미접수') */
  note?: string
}

/**
 * 태그 칩. 일반 태그는 중립색, SR 태그만 저채도 결정색(점 + 테두리)으로 구분한다.
 * 무지개색을 피하려고 배경은 항상 중립이다.
 */
export function TagChip({ tag, onClick, onSrClick, onRemove, size = 'sm', className, note }: TagChipProps) {
  const t = useT()
  const color = srTagColor(tag)
  const sr = isSrTag(tag)
  const click = sr && onSrClick ? onSrClick : onClick
  const body = (
    <>
      {sr ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} /> : <span className="text-muted-foreground">#</span>}
      <span className={cn('truncate', sr && 'font-mono')}>{tag}</span>
      {note && <span className="shrink-0 text-muted-foreground">{note}</span>}
    </>
  )
  return (
    <Chip
      label={tag}
      variant="tag"
      size={size}
      className={className}
      style={color ? { borderColor: color } : undefined}
      title={sr && onSrClick ? t('components.openSr', { code: tag }) : t('components.viewTag', { value: tag })}
      onClick={click ? () => click(tag) : undefined}
      onRemove={onRemove ? () => onRemove(tag) : undefined}
      removeLabel={t('components.removeTag', { value: tag })}
    >
      {body}
    </Chip>
  )
}
