import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

interface ReasonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  placeholder?: string
  onConfirm: (reason: string) => Promise<void> | void
}

/** 사유 입력이 필요한 액션(재개, 필수 미완료 완료 등) */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel = '확인', placeholder = '사유를 입력하세요', onConfirm }: ReasonDialogProps) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (!reason.trim()) return
    setBusy(true)
    try {
      await onConfirm(reason.trim())
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={placeholder} autoFocus className="text-xs" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button onClick={confirm} disabled={busy || !reason.trim()}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
