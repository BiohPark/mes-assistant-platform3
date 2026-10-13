import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

/** 놓인 항목 중 실제 파일만 고른다 — 폴더(브라우저가 빈 File로 넘긴다)와 빈 파일은 제외하고 그 수를 돌려준다 */
export function filesFromDataTransfer(data: DataTransfer): { files: File[]; rejected: number } {
  const items = data.items ? Array.from(data.items) : []
  const files = Array.from(data.files ?? []).filter((file, index) => !items[index]?.webkitGetAsEntry?.()?.isDirectory && file.size > 0)
  return { files, rejected: (data.files?.length ?? 0) - files.length }
}

interface FileDropZoneProps {
  /** 드래그 중 오버레이 문구 */
  label: string
  onFiles: (files: File[]) => void
  disabled?: boolean
  className?: string
  children: ReactNode
  'data-testid'?: string
}

/** 탐색기에서 끌어다 놓는 영역. 오버레이는 장식(aria-hidden)이고 결과는 호출자가 toast로 알린다 — 키보드 경로는 기존 첨부·업로드 버튼 */
export function FileDropZone({ label, onFiles, disabled, className, children, ...rest }: FileDropZoneProps) {
  const t = useT()
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0) // 자식 요소를 지날 때 enter/leave가 겹친다 — 바깥으로 완전히 나갈 때만 닫는다
  const carriesFiles = (event: DragEvent) => !disabled && Array.from(event.dataTransfer?.types ?? []).includes('Files')
  return <div
    {...rest}
    className={cn('relative', className)}
    onDragEnter={(event) => { if (!carriesFiles(event)) return; event.preventDefault(); depth.current += 1; setDragging(true) }}
    onDragOver={(event) => { if (!carriesFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
    onDragLeave={(event) => { if (!carriesFiles(event)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false) }}
    onDrop={(event) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      const { files, rejected } = filesFromDataTransfer(event.dataTransfer)
      if (rejected) toast.warning(t('dropzone.rejected', { count: rejected }))
      if (files.length) onFiles(files)
    }}
  >
    {children}
    {dragging && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/80 text-sm font-medium text-primary">{label}</div>}
  </div>
}
