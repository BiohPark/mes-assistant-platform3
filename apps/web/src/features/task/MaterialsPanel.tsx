import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle, CheckCheck, Download, Upload } from 'lucide-react'
import type { Task } from '@mes/domain'
import { toast } from 'sonner'
import { downloadBlob, getCandidates, filesForTask, fileVersions, setInput, setOutputTag, switchInputVersion, uploadFile, type FileCandidate, type FileMeta } from '@/api/files'
import { useActor } from '@/app/hooks'
import { subscribeEvent } from '@/app/useEvents'
import { Badge } from '@/components/ui/badge'
import { listAssistants } from '@/lib/catalog'
import { useT } from '@/i18n'
import { FileDropZone } from '@/components/FileDropZone'
import { FileList } from './FileList'
import { FilePreviewDialog } from './FilePreviewDialog'
import { InputToggle, StagedToggle } from './InputToggle'
import { ConversationInputs } from './ConversationInputs'

/**
 * 자료 패널(D54 개정) — 한 화면 위아래: 위 '자료함'(이 대화·같은 태그·연결 SR 첨부·같은 태그 대화, 각 파일 '쓴 적 있음'),
 * 아래 '다음 질문에 보낼 자료'(스테이징 = 하단 트레이와 같은 상태). 위에서 ☑ → 아래로, 아래 × → 해제. 보낸 파일은 서버가 비운다.
 */
export function MaterialsPanel({ task }: { task: Task }) {
  const actor = useActor()
  const t = useT()
  const uploadRef = useRef<HTMLInputElement>(null)
  const libraryId = useId()
  const stagedId = useId()
  const [preview, setPreview] = useState<FileMeta | null>(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const candidates = useQuery({ queryKey: ['candidates', task.id], queryFn: () => getCandidates(task.id) })
  const query = useQueryClient()
  // 연결 SR 첨부는 SR 쪽에서 바뀐다 — sr.updated(연결 업무 참여자에게도 전달됨)에 후보를 다시 읽는다
  useEffect(() => subscribeEvent(({ event }) => { if (event === 'sr.updated') void query.invalidateQueries({ queryKey: ['candidates', task.id] }) }), [query, task.id])
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const own = useQuery({ queryKey: ['files', task.id], queryFn: () => filesForTask(task.id) })
  const srFiles = candidates.data?.srFiles ?? []
  const used = new Set(candidates.data?.usedFileIds ?? [])
  const byId = new Map([...(candidates.data?.files ?? []).map((item) => [item.file.id, item.file] as const), ...srFiles.map((item) => [item.file.id, item.file] as const), ...(own.data ?? []).map((file) => [file.id, file] as const)])
  const selection = [...task.inputs].sort((a, b) => a.weight === b.weight ? 0 : a.weight === 'main' ? -1 : 1)
  const weightOf = (fileId: string) => task.inputs.find((input) => input.fileId === fileId)?.weight
  const shared = (candidates.data?.files ?? []).filter((item) => item.sourceTaskId !== task.id && item.viaTags.length && !item.newerVersionId && item.file.name.toLowerCase().includes(search.toLowerCase()))
  const assistantById = new Map(assistants.data?.map((item) => [item.id, item]) ?? [])
  const groups = new Map<string, FileCandidate[]>()
  for (const item of shared) groups.set(item.sourceAssistantId ?? '', [...(groups.get(item.sourceAssistantId ?? '') ?? []), item])
  const sortedGroups = [...groups].sort(([a], [b]) => (assistantById.get(a)?.order ?? Number.MAX_SAFE_INTEGER) - (assistantById.get(b)?.order ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b))
  const disabled = task.status === 'done'
  async function change(fileId: string, weight: 'main' | 'reference' | null) {
    try { await setInput(actor, task.id, fileId, weight) }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  async function upload(list: FileList | File[] | null) {
    if (!list?.length) return
    try {
      for (const file of Array.from(list)) await uploadFile(actor, { taskId: task.id }, file)
      toast.success(t('task.materials.uploaded', { count: list.length }), { description: t('task.materials.uploadShareHint') })
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  const usedMark = (fileId: string) => used.has(fileId) ? <Badge tone="success" data-testid={`used-${fileId}`} title={t('task.materials.usedTitle')} className="gap-0.5"><CheckCheck className="size-3" />{t('task.materials.used')}</Badge> : null
  const stage = (file: FileMeta) => <>{usedMark(file.id)}<InputToggle weight={weightOf(file.id)} label={file.name} showMain={false} disabled={disabled} onChange={(weight) => void change(file.id, weight)} /></>
  return <div className="flex h-full min-h-0 flex-col gap-3 text-xs" data-testid="materials-panel">
    {(candidates.isError || own.isError) && <div role="alert">{t('task.materials.loadFailed')} <button type="button" className="underline" onClick={() => { void candidates.refetch(); void own.refetch() }}>{t('common.retry')}</button></div>}
    <section data-tour="materials-library" data-testid="materials-library" aria-labelledby={libraryId} className="min-h-0 flex-1 space-y-3 overflow-y-auto">
      <div><h3 id={libraryId} className="text-sm font-medium">{t('task.materials.library')}</h3><p className="text-muted-foreground">{t('task.materials.libraryHelp')}</p></div>
      <FileDropZone data-testid="materials-own" label={t('dropzone.toUpload')} disabled={disabled} onFiles={(files) => void upload(files)}><div className="space-y-2">
        <div className="font-medium">{t('task.materials.ownSection')}</div>
        <FileList files={own.data ?? []} taskId={task.id} onPreview={setPreview} onToggleOutput={disabled ? undefined : (fileId, isOutput) => void setOutputTag(actor, task.id, fileId, isOutput).catch((error: unknown) => toast.error(String(error)))} canDelete={!disabled} deletableBy={actor.userId} renderActions={stage} />
        {!disabled && <><button type="button" className="flex w-full items-center justify-center gap-1 rounded-lg border p-1.5" onClick={() => uploadRef.current?.click()}><Upload className="size-3.5" />{t('task.materials.upload')}</button><input ref={uploadRef} type="file" multiple className="hidden" onChange={(event) => { void upload(event.target.files); event.target.value = '' }} /></>}
      </div></FileDropZone>
      <div data-testid="materials-shared" className="space-y-2 border-t pt-2">
        <div className="font-medium">{t('task.materials.sharedSection')}</div>
        <input aria-label={t('task.materials.searchShared')} placeholder={t('task.materials.searchPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border px-2 py-1" />
        {candidates.isPending ? <p className="text-muted-foreground">{t('common.loading')}</p>
          : candidates.isError ? null
          : !shared.length && (search ? <div className="space-y-1 rounded-xl border border-dashed p-3 text-center text-muted-foreground"><p>{t('task.materials.noSearchResults', { query: search })}</p><button type="button" className="underline" onClick={() => setSearch('')}>{t('task.materials.clearSearch')}</button></div>
            : <div className="rounded-xl border border-dashed p-3 text-center text-muted-foreground">{t('task.materials.noShared')}</div>)}
        {candidates.isSuccess && sortedGroups.flatMap(([assistantId, items]) => [<div key={`group-${assistantId}`} className="pt-1 font-medium" data-testid={`shared-group-${assistantId}`}>{assistantById.get(assistantId)?.name ?? assistantId}</div>, ...items.sort((a, b) => a.file.name.localeCompare(b.file.name) || a.file.version - b.file.version).map((item) => <div key={item.file.id} className="rounded-xl border p-2" data-testid={`candidate-file-${item.file.id}`}>
          <div className="flex items-center gap-1"><button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setPreview(item.file)}>{item.file.name} v{item.file.version}</button>{stage(item.file)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{item.role === 'output' ? <Badge tone="violet">{t('task.materials.roleOutput')}</Badge> : <Badge tone="neutral">{t('task.materials.roleUpload')}</Badge>} · <SourceLink taskId={item.sourceTaskId} code={item.sourceCode} title={item.sourceTitle} /> · {item.viaTags.join(', ')}
            {!!item.olderVersionIds?.length && <button type="button" className="ml-2 underline" onClick={() => setExpanded(expanded === item.file.id ? null : item.file.id)}>{t('task.materials.olderVersions', { count: item.olderVersionIds.length })}</button>}
          </div>
          {expanded === item.file.id && <OlderVersions file={item.file} task={task} disabled={disabled} onPreview={setPreview} onChange={change} />}
        </div>)])}
      </div>
      {srFiles.length > 0 && <div data-testid="materials-sr-files" className="space-y-2 border-t pt-2">
        <div className="text-xs font-medium">{t('task.materials.srFiles')} · <span className="font-mono">{srFiles[0]!.srCode}</span> <span className="font-normal text-muted-foreground">{srFiles[0]!.srTitle}</span></div>
        <p className="text-muted-foreground">{t('task.materials.srFilesHelp')}</p>
        {srFiles.map((item) => <div key={item.file.id} className="flex items-center gap-1 rounded-xl border p-2" data-testid={`sr-file-${item.file.id}`}>
          <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setPreview(item.file)}>{item.file.name} v{item.file.version}</button>
          <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted" aria-label={t('task.download')} onClick={() => void downloadBlob(item.file, t)}><Download className="size-3.5" /></button>
          {stage(item.file)}
        </div>)}
      </div>}
      <div className="space-y-2 border-t pt-2"><div className="font-medium">{t('task.materials.referenceConversations')}</div><ConversationInputs taskId={task.id} candidates={candidates.data?.conversations ?? []} disabled={disabled} /></div>
    </section>
    <section data-tour="materials-staged" data-testid="materials-staged" aria-labelledby={stagedId} className="max-h-[45%] shrink-0 space-y-2 overflow-y-auto border-t pt-2">
      <div><h3 id={stagedId} className="text-sm font-medium">{t('task.materials.staged', { count: selection.length })}</h3><p className="text-muted-foreground">{t('task.materials.stagedHelp')}</p></div>
      <div data-testid="materials-inputs" className="space-y-2">
        {!selection.length && <div className="rounded-xl border border-dashed p-3 text-center text-muted-foreground">{t('task.materials.noSelection')}</div>}
        {selection.map((input) => {
          const file = byId.get(input.fileId)
          if (!file) return candidates.isPending || own.isPending ? null : <div key={input.fileId} className="rounded-xl border p-2 text-muted-foreground" data-testid={`selected-file-${input.fileId}`}>{t('task.materials.inputUnavailable')}</div>
          const candidate = candidates.data?.files.find((item) => item.file.id === file.id)
          const newerVersionId = candidate?.newerVersionId
          return <div key={file.id} className="rounded-xl border p-2" data-testid={`selected-file-${file.id}`}>
            <div className="flex items-center gap-2"><button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setPreview(file)}>{file.name} v{file.version}</button><StagedToggle weight={input.weight} label={file.name} disabled={disabled} onChange={(weight) => void change(file.id, weight)} /></div>
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground"><span>{input.weight === 'main' ? t('task.mainInput') : t('task.reference')} · {file.originTaskId === task.id ? t('task.thisConversation') : file.originSrId ? <>{t('task.materials.srAttachment')} · <span className="font-mono">{srFiles.find((item) => item.file.id === file.id)?.srCode}</span></> : <SourceLink taskId={file.originTaskId} code={candidate?.sourceCode} title={candidate?.sourceTitle} />}</span>
              {newerVersionId && !disabled && <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-tone-info-fg/40 px-1 text-tone-info-fg" onClick={() => void switchInputVersion(actor, task.id, file.id, newerVersionId).catch((error: unknown) => toast.error(String(error)))}><ArrowUpCircle className="size-3" />{t('task.materials.newVersion')}</button>}
            </div>
          </div>
        })}
      </div>
      <ConversationInputs taskId={task.id} candidates={candidates.data?.conversations ?? []} disabled={disabled} selectedOnly />
    </section>
    <FilePreviewDialog file={preview} onClose={() => setPreview(null)} />
  </div>
}

/** 출처 대화 표시 — 내부 ID는 링크 주소에만 쓰고 화면에는 코드·제목을 보여 준다 */
function SourceLink({ taskId, code, title }: { taskId?: string; code?: string; title?: string }) {
  const t = useT()
  if (!taskId) return null
  return <><a href={`/c/${taskId}`} className="font-mono underline">{code ?? t('task.conversation')}</a>{title && <> · {title}</>}</>
}

function OlderVersions({ file, task, disabled, onPreview, onChange }: { file: FileMeta; task: Task; disabled: boolean; onPreview: (file: FileMeta) => void; onChange: (fileId: string, weight: 'main' | 'reference' | null) => Promise<void> }) {
  const versions = useQuery({ queryKey: ['file-versions', file.id], queryFn: () => fileVersions(file.id) })
  return <ul className="mt-2 space-y-1 border-l pl-2">{versions.data?.filter((version) => version.id !== file.id).map((version) => <li key={version.id} className="flex items-center gap-1">
    <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onPreview(version)}>{version.name} v{version.version}</button>
    <InputToggle weight={task.inputs.find((input) => input.fileId === version.id)?.weight} label={`${version.name} v${version.version}`} showMain={false} disabled={disabled} onChange={(weight) => void onChange(version.id, weight)} />
  </li>)}</ul>
}
