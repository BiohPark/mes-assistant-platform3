import type { LlmPorts } from './ports.js'
import type { FileAsset, LlmSettings } from '@mes/domain'

function openWebUiBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/api$/, '')
}

/**
 * OpenWebUI Files API 전달: 업로드 → 처리 완료 확인 → 채팅 요청의 files 파라미터.
 * 실패한 파일은 돌려주기만 하고 대신 본문을 넣지 않는다 — 요청을 멈추고 사용자가
 * 재시도·제외·텍스트로 보내기를 고른다 (docs/fusion-design.md §6-7).
 */

/** chat/completions 요청의 files 파라미터 (OpenWebUI 확장) */
export interface AttachedFile {
  type: 'file'
  id: string
}

export interface FileDeliveryResult {
  attached: Map<string, AttachedFile>
  failed: Array<{ file: FileAsset; reason: string }>
}

export interface DeliverOptions {
  signal?: AbortSignal
  /** 처리 상태 확인 간격 (기본 2초) */
  pollMs?: number
  /** 파일 하나의 처리 대기 한도 (기본 5분) */
  processTimeoutMs?: number
  /** 진행 표시: 몇 번째 파일을 어느 단계에서 다루는지 */
  onProgress?: (p: { index: number; total: number; name: string; phase: 'uploading' | 'processing' }) => void
}

const POLL_MS = 2_000
const PROCESS_TIMEOUT_MS = 5 * 60_000

/** 키 원문을 남기지 않는 짧은 해시 (캐시 범위 구분용, 보안 목적 아님) */
function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** 원격 ID 캐시 키: 서버와 키(사용자)가 바뀌면 다시 올린다. OpenWebUI 파일은 사용자별이다. */
export function remoteKey(settings: Pick<LlmSettings, 'baseUrl' | 'apiKey'>): string {
  return `${openWebUiBase(settings.baseUrl)}#${shortHash(settings.apiKey ?? '')}`
}

export function usesFilesApi(settings: LlmSettings): boolean {
  return settings.mode === 'live' && settings.fileDelivery === 'openwebui'
}

/** 업로드 이름에 버전을 붙인다: `URS.md` v2 → `URS (v2).md` (v1·v2를 함께 고르면 구분되게) */
export function versionedName(name: string, version: number): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (v${version})${name.slice(dot)}` : `${name} (v${version})`
}

function authHeaders(settings: LlmSettings): Record<string, string> {
  return settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}
}

function abortError(): DOMException {
  return new DOMException('요청이 중지되었습니다.', 'AbortError')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

class DeliveryError extends Error {}

/** POST {root}/api/v1/files/ (multipart) → { id } */
export async function uploadToOpenWebUi(settings: LlmSettings, file: FileAsset, ports: Pick<LlmPorts, 'readFileBytes'>, signal?: AbortSignal): Promise<string> {
  const form = new FormData()
  form.append('file', new File([Uint8Array.from(await ports.readFileBytes(file))], versionedName(file.name, file.version), { type: file.mime || 'application/octet-stream' }))
  const res = await fetch(`${openWebUiBase(settings.baseUrl)}/api/v1/files/`, { method: 'POST', headers: authHeaders(settings), body: form, signal })
  if (!res.ok) throw new DeliveryError(`업로드 실패 (HTTP ${res.status})`)
  const body = (await res.json()) as { id?: unknown }
  if (typeof body.id !== 'string' || !body.id) throw new DeliveryError('업로드 응답에 파일 ID가 없습니다')
  return body.id
}

/** 처리 완료까지 대기. 상태 경로가 없는 버전(404)은 처리된 것으로 본다. */
async function waitProcessed(settings: LlmSettings, file: FileAsset, remoteId: string, opts: DeliverOptions, cached = false): Promise<void> {
  const url = `${openWebUiBase(settings.baseUrl)}/api/v1/files/${encodeURIComponent(remoteId)}/process/status`
  const deadline = Date.now() + (opts.processTimeoutMs ?? PROCESS_TIMEOUT_MS)
  for (;;) {
    const res = await fetch(url, { headers: authHeaders(settings), signal: opts.signal })
    if (res.status === 404) {
      if (cached) throw new DeliveryError('캐시된 파일이 없습니다')
      return
    }
    if (!res.ok) throw new DeliveryError(`처리 상태 확인 실패 (HTTP ${res.status})`)
    const status = ((await res.json()) as { status?: unknown }).status
    if (status === 'completed') return
    if (status === 'failed') throw new DeliveryError(`OpenWebUI 파일 처리 실패: ${file.name}`)
    if (Date.now() >= deadline) throw new DeliveryError(`파일 처리 시간 초과: ${file.name}`)
    await sleep(opts.pollMs ?? POLL_MS, opts.signal)
  }
}

/**
 * 선택한 입력 파일을 주어진 순서대로 올린다(이미 처리까지 끝난 버전은 재사용).
 * 파일별 실패는 failed로 돌려주고, 중지(abort)는 예외로 전체를 멈춘다.
 */
export async function deliverFiles(settings: LlmSettings, files: FileAsset[], opts: DeliverOptions = {}, ports: Pick<LlmPorts, 'readFileBytes' | 'updateFileRemoteIds'>): Promise<FileDeliveryResult> {
  const key = remoteKey(settings)
  const attached = new Map<string, AttachedFile>()
  const failed: FileDeliveryResult['failed'] = []
  for (const [index, file] of files.entries()) {
    const cached = file.remoteIds?.[key]
    if (cached) {
      try {
        opts.onProgress?.({ index, total: files.length, name: file.name, phase: 'processing' })
        await waitProcessed(settings, file, cached, opts, true)
        attached.set(file.id, { type: 'file', id: cached })
        continue
      } catch (error) {
        if (opts.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortError()
      }
    }
    try {
      opts.onProgress?.({ index, total: files.length, name: file.name, phase: 'uploading' })
      const remoteId = await uploadToOpenWebUi(settings, file, ports, opts.signal)
      opts.onProgress?.({ index, total: files.length, name: file.name, phase: 'processing' })
      await waitProcessed(settings, file, remoteId, opts)
      // 처리까지 끝난 것만 캐시 (중간 실패한 업로드를 재사용하지 않게)
      await ports.updateFileRemoteIds(file.id, { ...file.remoteIds, [key]: remoteId })
      attached.set(file.id, { type: 'file', id: remoteId })
    } catch (e) {
      if (opts.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw abortError()
      failed.push({ file, reason: e instanceof DeliveryError ? e.message : `네트워크 오류: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  return { attached, failed }
}
