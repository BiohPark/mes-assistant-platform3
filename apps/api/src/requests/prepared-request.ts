import { deliverFiles, type BuiltRequest, type DeliverOptions, type LlmPorts } from '@mes/llm'
import type { FileAsset, FileRequestInput } from '@mes/domain'

export interface PreparedRequest { built: BuiltRequest; files: FileAsset[] }

/** 검증한 조립 결과는 유지하고, 전송 직전에 파일의 원격 ID만 채운다. */
export async function deliverPreparedRequest({ built, files }: PreparedRequest, ports: Pick<LlmPorts, 'readFileBytes' | 'updateFileRemoteIds'>, options: DeliverOptions = {}): Promise<BuiltRequest> {
  if (!built.files?.length) return built
  if (files.length !== built.files.length) throw new Error('검증한 첨부 파일을 찾을 수 없습니다')
  const delivered = await deliverFiles(built.settings.llm, files, options, ports)
  const inputs = built.info.inputs.map(input => {
    if (input.kind !== 'file' || input.delivery !== 'attached') return input
    const failure = delivered.failed.find(item => item.file.id === input.fileId)
    return failure ? { ...input, delivery: 'failed' as const, error: failure.reason }
      : { ...input, remoteId: delivered.attached.get(input.fileId)!.id }
  })
  return { ...built, files: files.flatMap(file => delivered.attached.get(file.id) ?? []), info: { ...built.info, inputs },
    failed: inputs.filter((input): input is FileRequestInput => input.kind === 'file' && input.delivery === 'failed') }
}
