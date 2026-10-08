import { useT } from '@/i18n'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => Promise<void> | void
  onCloseAutoFocus?: (event: Event) => void
}

/** 파괴적 액션 확인. window.confirm 대신 항상 이것을 쓴다. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive = true, onConfirm, onCloseAutoFocus }: ConfirmDialogProps) {
  const t = useT()
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={handleConfirm} disabled={busy}>
            {confirmLabel ?? t('components.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
