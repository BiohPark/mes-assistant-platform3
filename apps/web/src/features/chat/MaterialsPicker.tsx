import type { ReactNode } from 'react'
import type { Task } from '@mes/domain'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MaterialsPanel } from '@/features/task/MaterialsPanel'
import { useT } from '@/i18n'

export function MaterialsPicker({ task, onClose, onUpload, previous, restoreFocus }: { task: Task; onClose: () => void; onUpload: (files: File[]) => void; previous?: ReactNode; restoreFocus?: () => void }) {
  const t = useT()
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent onCloseAutoFocus={event => { if (restoreFocus) { event.preventDefault(); restoreFocus() } }} className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{t('task.materials.picker')}</DialogTitle><DialogDescription>{t('task.materials.selectionHint')}</DialogDescription></DialogHeader>
    {previous}
    <MaterialsPanel task={task} picker onUpload={onUpload} />
  </DialogContent></Dialog>
}
