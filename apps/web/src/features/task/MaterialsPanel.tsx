import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle, ClipboardList, Download, Upload } from 'lucide-react'
import type { Task } from '@mes/domain'
import { toast } from 'sonner'
import { downloadBlob, getCandidates, filesForTask, fileVersions, setInput, setOutputTag, switchInputVersion, uploadFile, type FileCandidate, type FileMeta } from '@/api/files'
import { useActor } from '@/app/hooks'
import { subscribeEvent } from '@/app/useEvents'
import { Badge } from '@/components/ui/badge'
import { HelpTip } from '@/components/HelpTip'
import { listAssistants } from '@/lib/catalog'
import { useT } from '@/i18n'
import { FileDropZone } from '@/components/FileDropZone'
import { FileList } from './FileList'
import { FilePreviewDialog } from './FilePreviewDialog'
import { AttachToggle, UsedMark } from './AttachToggle'
import { ConversationInputs } from './ConversationInputs'
import { listSrInputs, setSrInput, srInputsKey } from './srInputs'

/**
 * 자료 패널(S14) — '자료함' 목록만: 이 대화·같은 태그 파일·연결 SR 본문·연결 SR 첨부·같은 태그 대화.
 * 각 항목의 [첨부]로 입력창 칩에 붙이고('첨부됨'을 다시 누르면 뺀다), 보낸 뒤에는 서버가 비우고 '사용됨'을 붙인다.
 */
export function MaterialsPanel({ task }: { task: Task }) {
  const actor = useActor()
  const t = useT()
  const uploadRef = useRef<HTMLInputElement>(null)
  const libraryId = useId()
  const [preview, setPreview] = useState<FileMeta | null>(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const candidates = useQuery({ queryKey: ['candidates', task.id], queryFn: () => getCandidates(task.id) })
  const query = useQueryClient()
  // 연결 SR 첨부는 SR 쪽에서 바뀐다 — sr.updated(연결 업무 참여자에게도 전달됨)에 후보를 다시 읽는다
  useEffect(() => subscribeEvent(({ event }) => { if (event === 'sr.updated') void query.invalidateQueries({ queryKey: ['candidates', task.id] }) }), [query, task.id])
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const own = useQuery({ queryKey: ['files', task.id], queryFn: () => filesForTask(task.id) })
  // 서버가 아직 연결 SR 본문 첨부를 모르면(404) 구역째 숨긴다 — 오류 안내는 하지 않는다
  const srBodies = useQuery({ queryKey: srInputsKey(task.id), queryFn: () => listSrInputs(task.id), retry: false })
  const srFiles = candidates.data?.srFiles ?? []
  const used = new Set(candidates.data?.usedFileIds ?? [])
  const weightOf = (fileId: string) => task.inputs.find((input) => input.fileId === fileId)?.weight
  const newerOf = new Map((candidates.data?.files ?? []).map((item) => [item.file.id, item.newerVersionId]))
  // 첨부 중인 이전 버전은 새 버전으로 바꿀 수 있게 목록에 남긴다
  const shared = (candidates.data?.files ?? []).filter((item) => item.sourceTaskId !== task.id && item.viaTags.length && (!item.newerVersionId || !!weightOf(item.file.id)) && item.file.name.toLowerCase().includes(search.toLowerCase()))
  const assistantById = new Map(assistants.data?.map((item) => [item.id, item]) ?? [])
  const groups = new Map<string, FileCandidate[]>()
  for (const item of shared) groups.set(item.sourceAssistantId ?? '', [...(groups.get(item.sourceAssistantId ?? '') ?? []), item])
  const sortedGroups = [...groups].sort(([a], [b]) => (assistantById.get(a)?.order ?? Number.MAX_SAFE_INTEGER) - (assistantById.get(b)?.order ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b))
  const disabled = task.status === 'done'
  async function run(action: Promise<unknown>) {
    try { await action } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  const change = (fileId: string, weight: 'main' | 'reference' | null) => run(setInput(actor, task.id, fileId, weight))
  async function upload(list: FileList | File[] | null) {
    if (!list?.length) return
    try {
      for (const file of Array.from(list)) await uploadFile(actor, { taskId: task.id }, file)
      toast.success(t('task.materials.uploaded', { count: list.length }), { description: t('task.materials.uploadShareHint') })
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  const attach = (file: FileMeta, label = file.name) => <AttachToggle attached={!!weightOf(file.id)} label={label} disabled={disabled} onToggle={() => void change(file.id, weightOf(file.id) ? null : 'reference')} />
  // 첨부 중인 이전 버전이면 새 버전으로 바꾸기(사람이 고른다 — 자동 교체 없음)
  const switchVersion = (file: FileMeta) => {
    const newer = newerOf.get(file.id)
    return newer && !disabled && !!weightOf(file.id) && <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-tone-info-fg/40 px-1 text-tone-info-fg" onClick={() => void run(switchInputVersion(actor, task.id, file.id, newer))}><ArrowUpCircle className="size-3" />{t('task.materials.newVersion')}</button>
  }
  const stage = (file: FileMeta) => <>{switchVersion(file)}{used.has(file.id) && <UsedMark testId={`used-${file.id}`} />}{attach(file)}</>
  return <div className="flex h-full min-h-0 flex-col gap-3 text-xs" data-testid="materials-panel">
    {(candidates.isError || own.isError) && <div role="alert">{t('task.materials.loadFailed')} <button type="button" className="underline" onClick={() => { void candidates.refetch(); void own.refetch() }}>{t('common.retry')}</button></div>}
    <section data-tour="materials-library" data-testid="materials-library" aria-labelledby={libraryId} className="min-h-0 flex-1 space-y-3 overflow-y-auto">
      <div className="flex items-center gap-1"><h3 id={libraryId} className="text-sm font-medium">{t('task.materials.library')}</h3><HelpTip text={t('task.materials.libraryHelp')} /></div>
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
          {expanded === item.file.id && <OlderVersions file={item.file} attach={attach} onPreview={setPreview} />}
        </div>)])}
      </div>
      {!!srBodies.data?.length && <div data-testid="materials-sr-bodies" className="space-y-2 border-t pt-2">
        <div className="flex items-center gap-1 font-medium">{t('task.materials.srBodies')}<HelpTip text={t('task.materials.srBodiesHelp')} /></div>
        {srBodies.data.map((item) => <div key={item.srId} className="flex items-center gap-1 rounded-xl border p-2" data-testid={`sr-body-${item.srId}`}>
          <ClipboardList className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate"><span className="font-mono">{item.code}</span> · {item.title}</span>
          {item.used && <UsedMark />}
          <AttachToggle attached={item.selected} label={item.code} disabled={disabled} onToggle={() => void run(setSrInput(task.id, item.srId, !item.selected))} />
        </div>)}
      </div>}
      {srFiles.length > 0 && <div data-testid="materials-sr-files" className="space-y-2 border-t pt-2">
        <div className="flex items-center gap-1 text-xs font-medium">{t('task.materials.srFiles')} · <span className="font-mono">{srFiles[0]!.srCode}</span> <span className="truncate font-normal text-muted-foreground">{srFiles[0]!.srTitle}</span><HelpTip text={t('task.materials.srFilesHelp')} /></div>
        {srFiles.map((item) => <div key={item.file.id} className="flex items-center gap-1 rounded-xl border p-2" data-testid={`sr-file-${item.file.id}`}>
          <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setPreview(item.file)}>{item.file.name} v{item.file.version}</button>
          <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted" aria-label={t('task.download')} onClick={() => void downloadBlob(item.file, t)}><Download className="size-3.5" /></button>
          {stage(item.file)}
        </div>)}
      </div>}
      <div data-tour="materials-conversations" className="space-y-2 border-t pt-2"><div className="text-sm font-semibold">{t('task.materials.sameTagConversations', { count: candidates.data?.conversations.length ?? 0 })}</div><ConversationInputs taskId={task.id} candidates={candidates.data?.conversations ?? []} disabled={disabled} /></div>
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

function OlderVersions({ file, attach, onPreview }: { file: FileMeta; attach: (file: FileMeta, label: string) => ReactNode; onPreview: (file: FileMeta) => void }) {
  const versions = useQuery({ queryKey: ['file-versions', file.id], queryFn: () => fileVersions(file.id) })
  return <ul className="mt-2 space-y-1 border-l pl-2">{versions.data?.filter((version) => version.id !== file.id).map((version) => <li key={version.id} className="flex items-center gap-1">
    <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onPreview(version)}>{version.name} v{version.version}</button>
    {attach(version, `${version.name} v${version.version}`)}
  </li>)}</ul>
}
