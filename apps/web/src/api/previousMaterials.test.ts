import { afterEach, expect, it, vi } from 'vitest'
import { reattachMaterials } from './previousMaterials'
import { inputSelection } from './inputSelection'
import { queryClient } from './queryClient'

afterEach(() => { vi.unstubAllGlobals(); queryClient.clear() })
it('explicitly reselects exact file versions and conversation snapshots once without widening the range', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetcher)
  await reattachMaterials({ userId: 'u' }, 't', [
    { kind: 'file', fileId: 'v1', weight: 'main' },
    { kind: 'sr', srId: 'sr' },
    { kind: 'conversation', sourceTaskId: 'source', snapshotId: 'snapshot', mode: 'messages', weight: 'reference' },
  ])
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(fetcher).toHaveBeenCalledWith('/api/tasks/t/conversation-inputs/source', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mode: 'messages', weight: 'reference', snapshotId: 'snapshot' }) }))
  expect(inputSelection.getState().byTask.t?.pending).toBe(0)
})
