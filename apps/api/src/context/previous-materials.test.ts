import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { afterEach, expect, it, vi } from 'vitest'
import type { Db } from '../db/db.module.js'
import { assertTaskAccess } from '../sr/access.js'
import { assertFileReadable, taskSrAttachments } from '../files/sr-attachments.js'
import { linkedTaskSrs } from '../tasks/sr-inputs.service.js'
import { DbConversationInputsService } from './conversation-inputs.service.js'

vi.mock('../sr/access.js', () => ({ assertTaskAccess: vi.fn(async () => {}) }))
vi.mock('../files/sr-attachments.js', () => ({ assertFileReadable: vi.fn(async () => {}), taskSrAttachments: vi.fn(async () => [{ file: { id: 'linked-sr-file' } }]) }))
vi.mock('../tasks/sr-inputs.service.js', () => ({ linkedTaskSrs: vi.fn(async () => [{ id: 'sr' }]) }))
afterEach(() => vi.clearAllMocks())
function setup(results: unknown[][]) {
  const select = vi.fn(() => {
    const result = results.shift() ?? []
    const chain = Promise.resolve(result) as unknown as Record<string, unknown>
    for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) chain[method] = () => chain
    return chain
  })
  const service = new DbConversationInputsService({ select } as unknown as Db)
  vi.spyOn(service as unknown as { taskRow: (id: string) => Promise<unknown> }, 'taskRow').mockImplementation(async id => { if (id === 'deleted') throw new NotFoundException(); return {} })
  vi.spyOn(service as unknown as { shared: (target: string, source: string) => Promise<boolean> }, 'shared').mockImplementation(async (_, source) => source !== 'unshared')
  return { service, select }
}
it('reads exact preceding inputs, skips deleted/forbidden/unlinked sources, and does not select anything', async () => {
  vi.mocked(assertTaskAccess).mockImplementation(async (_, _actor, source) => { if (source === 'denied') throw new ForbiddenException() })
  vi.mocked(assertFileReadable).mockImplementation(async (_, _actor, file) => { if (file === 'denied-file') throw new ForbiddenException() })
  const { service, select } = setup([[{ id: 'previous' }], [
    { kind: 'file', fileId: 'v1', weight: 'main' }, { kind: 'file', fileId: 'gone', weight: 'reference' }, { kind: 'file', fileId: 'denied-file', weight: 'reference' },
    { kind: 'sr', srId: 'sr' }, { kind: 'sr', srId: 'unlinked' },
    ...['source', 'deleted', 'denied', 'unshared'].map(sourceTaskId => ({ kind: 'conversation', sourceTaskId, snapshotId: 'snap', mode: 'messages', weight: 'reference' })),
  ], [{ id: 'v1', originTaskId: 'target' }], [], [{ id: 'denied-file', originTaskId: 'target' }]])
  expect(await service.previousMaterials('actor', 'target')).toEqual([
    { kind: 'file', fileId: 'v1', weight: 'main' }, { kind: 'sr', srId: 'sr' },
    { kind: 'conversation', sourceTaskId: 'source', snapshotId: 'snap', mode: 'messages', weight: 'reference' },
  ])
  expect(select).toHaveBeenCalledTimes(5)
  expect(linkedTaskSrs).toHaveBeenCalledWith(expect.anything(), 'actor', 'target')
})
it('does not look back for nonempty materials when the preceding request is empty', async () => {
  const { service, select } = setup([[{ id: 'last' }], []])
  expect(await service.previousMaterials('actor', 'target')).toEqual([])
  expect(select).toHaveBeenCalledTimes(2)
})
it('denies access to the target before reading request history', async () => {
  vi.mocked(assertTaskAccess).mockRejectedValueOnce(new ForbiddenException())
  const { service, select } = setup([])
  await expect(service.previousMaterials('actor', 'target')).rejects.toMatchObject({ status: 403 })
  expect(select).not.toHaveBeenCalled()
})

it('keeps a readable linked SR attachment even when its SR body is not visible to the business owner', async () => {
  const { service } = setup([[{ id: 'last' }], [{ kind: 'file', fileId: 'linked-sr-file', weight: 'reference' }], [{ id: 'linked-sr-file', originSrId: 'other-requester-sr' }]])
  expect(await service.previousMaterials('actor', 'target')).toEqual([{ kind: 'file', fileId: 'linked-sr-file', weight: 'reference' }])
  expect(taskSrAttachments).toHaveBeenCalledWith(expect.anything(), 'target')
})
