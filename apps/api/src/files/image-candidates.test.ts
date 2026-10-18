import { expect, it, vi } from 'vitest'
import { DbFilesService } from './files.service.js'

it('does not assemble a selected SR image as a task file version', async () => {
  const image = { id: 'sr-image', kind: 'ai_output', originSrId: 'sr', originTaskId: null, version: 1,
    uploadedAt: new Date(), originalName: 'image.png', source: 'assistant' }
  const service = new DbFilesService({} as never, {} as never, {} as never)
  const internals = service as any
  vi.spyOn(internals, 'candidateRows').mockResolvedValue({ rows: [image], chainRows: [],
    selected: [{ fileId: image.id, weight: 'main' }], via: new Map() })
  vi.spyOn(internals, 'linkedSrFiles').mockResolvedValue([{ file: image, selected: 'main' }])
  vi.spyOn(internals, 'usedFileIds').mockResolvedValue([])
  // Conversation candidates are independent of the file-chain regression.
  const { DbConversationInputsService } = await import('../context/conversation-inputs.service.js')
  vi.spyOn(DbConversationInputsService.prototype, 'candidates').mockResolvedValue([] as never)
  try {
    const result = await service.candidates('task')
    expect(result.files).toEqual([])
    expect(result.srFiles).toEqual([{ file: image, selected: 'main' }])
  } finally { vi.restoreAllMocks() }
})
