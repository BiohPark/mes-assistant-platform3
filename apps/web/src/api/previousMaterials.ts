import type { PreviousMaterial } from '@mes/contracts'
import { setInput } from './files'
import { selectConversation } from './conversationInputs'
import { selectSrInput } from './srInputs'
import { saveInputSelection } from './inputSelection'
import type { Actor } from './tasks'

export async function getPreviousMaterials(taskId: string): Promise<PreviousMaterial[]> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/conversation-inputs/previous-materials`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  return response.json() as Promise<PreviousMaterial[]>
}
/** One explicit action; individual APIs retain access checks and refresh the same estimate. */
export async function reattachMaterials(actor: Actor, taskId: string, materials: PreviousMaterial[]) {
  return saveInputSelection(taskId, async () => {
    const results = await Promise.allSettled(materials.map(item => item.kind === 'file' ? setInput(actor, taskId, item.fileId, item.weight)
      : item.kind === 'sr' ? selectSrInput(taskId, item.srId)
        : selectConversation(taskId, item.sourceTaskId, { mode: item.mode, weight: item.weight, snapshotId: item.snapshotId })))
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  })
}
