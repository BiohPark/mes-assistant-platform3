import { useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpCircle, ClipboardList, Download, Upload } from 'lucide-react'
import type { Task } from '@mes/domain'
import { toast } from 'sonner'
import { downloadBlob, fileVersions, setInput, setOutputTag, switchInputVersion, uploadFile, type FileCandidate, type FileMeta } from '@/api/files'
import { useActor } from '@/app/hooks'
import { Badge } from '@/components/ui/badge'
import { HelpTip } from '@/components/HelpTip'
import { listAssistants } from '@/lib/catalog'
import { useT } from '@/i18n'
import { FileDropZone } from '@/components/FileDropZone'
import { FileList, isAiGenerated } from './FileList'
import { FilePreviewDialog } from './FilePreviewDialog'
import { AttachToggle, UsedMark } from './AttachToggle'
import { ConversationInputs } from './ConversationInputs'
import { removeSrInput, selectSrInput } from '@/api/srInputs'
import { cn } from '@/lib/utils'
import { useMaterialCandidates } from '@/features/chat/useMaterialCandidates'
import { inputSelection } from '@/api/inputSelection'
import { useTagShareStore } from './tagShare'
import { useMaterialsDrawer, useRailState } from './materialsDrawer'

/**
 * 자료 패널(S14) — '자료함' 목록만: 이 대화·같은 태그 파일·연결 SR 본문·연결 SR 첨부·같은 태그 대화.
 * 각 항목의 [첨부]로 입력창 칩에 붙이고('첨부됨'을 다시 누르면 뺀다), 보낸 뒤에는 서버가 비우고 '사용됨'을 붙인다.
 * 내 태그 변경 직후에는 들어온 항목을 표시(data-fresh)하고 빠진 항목을 잠시 남긴다(tagShare).
 */
export function MaterialsPanel({ task, embedded = false, picker = false, onUpload }: { task: Task; embedded?: boolean; picker?: boolean; onUpload?: (files: File[]) => void }) {
  const actor = useActor()
  const t = useT()
  const uploadRef = useRef<HTMLInputElement>(null)
  const libraryId = useId()
  const [preview, setPreview] = useState<FileMeta | null>(null)
  const [localSearch, setLocalSearch] = useState('')
  const state = useRailState(task.id)
  const update = useMaterialsDrawer(s => s.update)
  const search = embedded ? state.materialsSearch : localSearch
  const setSearch = (value: string) => { if (embedded) update(task.id, { materialsSearch: value }); else setLocalSearch(value) }
  const [expanded, setExpanded] = useState<string | null>(null)
  const share = useTagShareStore((state) => state.byTask[task.id])
  const fresh = new Set(share?.fresh)
  const { candidates, own, srBodies } = useMaterialCandidates(task.id)
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const matches = (...values: (string | undefined)[]) => !search || values.some(value => value?.toLowerCase().includes(search.toLowerCase()))
  const saving = inputSelection(state => !!state.byTask[task.id]?.sending || (state.byTask[task.id]?.pending ?? 0) > 0)
  const srFiles = (candidates.data?.srFiles ?? []).filter(item => !picker || matches(item.file.name, item.srCode, item.srTitle))
  const bodies = (srBodies.data ?? []).filter(item => !picker || matches(item.code, item.title))
  const ownFiles = (own.data ?? []).filter(file => !picker || matches(file.name))
  const conversations = (candidates.data?.conversations ?? []).filter(item => !picker || matches(item.code, item.title, ...item.sharedTags))
  const used = new Set(candidates.data?.usedFileIds ?? [])
  const weightOf = (fileId: string) => task.inputs.find((input) => input.fileId === fileId)?.weight
  const newerOf = new Map((candidates.data?.files ?? []).map((item) => [item.file.id, item.newerVersionId]))
  // 첨부 중인 이전 버전은 새 버전으로 바꿀 수 있게 목록에 남긴다
  const shared = (candidates.data?.files ?? []).filter((item) => item.sourceTaskId !== task.id && item.viaTags.length && (!item.newerVersionId || !!weightOf(item.file.id)) && (picker ? matches(item.file.name, item.sourceCode, item.sourceTitle, ...item.viaTags) : item.file.name.toLowerCase().includes(search.toLowerCase())))
  const assistantById = new Map(assistants.data?.map((item) => [item.id, item]) ?? [])
  const groups = new Map<string, FileCandidate[]>()
  for (const item of shared) groups.set(item.sourceAssistantId ?? '', [...(groups.get(item.sourceAssistantId ?? '') ?? []), item])
  const sortedGroups = [...groups].sort(([a], [b]) => (assistantById.get(a)?.order ?? Number.MAX_SAFE_INTEGER) - (assistantById.get(b)?.order ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b))
  const disabled = task.status === 'done' || saving
  async function run(action: Promise<unknown>) {
    try { await action } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  const change = (fileId: string, weight: 'main' | 'reference' | null) => run(setInput(actor, task.id, fileId, weight))
  async function upload(list: FileList | File[] | null) {
    if (!list?.length) return
    if (onUpload) { onUpload(Array.from(list)); return }
    try {
      for (const file of Array.from(list)) await uploadFile(actor, { taskId: task.id }, file)
      toast.success(t('task.materials.uploaded', { count: list.length }), { description: t('task.materials.uploadShareHint') })
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  const attach = (file: FileMeta, label = file.name) => <AttachToggle inputLabels attached={!!weightOf(file.id)} label={label} disabled={disabled} onToggle={() => void change(file.id, weightOf(file.id) ? null : 'reference')} />
  // 첨부 중인 이전 버전이면 새 버전으로 바꾸기(사람이 고른다 — 자동 교체 없음)
  const switchVersion = (file: FileMeta) => {
    const newer = newerOf.get(file.id)
    return newer && !disabled && !!weightOf(file.id) && <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-tone-info-fg/40 px-1 text-tone-info-fg" onClick={() => void run(switchInputVersion(actor, task.id, file.id, newer))}><ArrowUpCircle className="size-3" />{t('task.materials.newVersion')}</button>
  }
  const stage = (file: FileMeta) => <>{switchVersion(file)}{used.has(file.id) && <UsedMark testId={`used-${file.id}`} />}{attach(file)}</>
  if (picker && preview) return <FilePreviewDialog file={preview} embedded onClose={() => setPreview(null)} />
  return <div className="flex shrink-0 flex-col gap-3 text-xs" data-testid="materials-panel">
    {(candidates.isError || own.isError) && <div role="alert">{t('task.materials.loadFailed')} <button type="button" className="underline" onClick={() => { void candidates.refetch(); void own.refetch() }}>{t('common.retry')}</button></div>}
    {!picker && <p className="text-muted-foreground">{t('task.materials.selectionHint')}</p>}
    {picker && <><button type="button" disabled={saving} className="rounded-lg border p-2 text-left" onClick={() => uploadRef.current?.click()}>{t('task.materials.uploadComputer')}</button><input autoFocus aria-label={t('task.materials.searchAll')} placeholder={t('task.materials.searchAll')} value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></>}
    <section data-tour="materials-library" data-testid="materials-library" aria-labelledby={picker ? undefined : libraryId} className="space-y-3">
      {!picker && <div className={cn('flex items-center gap-1', embedded && 'max-lg:hidden')}><h3 id={libraryId} className="text-sm font-medium">{t('task.materials.linkedLibrary')}</h3><HelpTip text={t('task.materials.libraryHelp')} /></div>}
      {!!share?.gone.length && <div data-testid="materials-gone" className="space-y-1 rounded-xl border border-dashed p-2 text-muted-foreground">
        <div className="flex items-center gap-1 font-medium">{t('task.materials.gone')}<HelpTip text={t('task.materials.goneHelp')} /></div>
        <ul className="flex flex-wrap gap-1">{share.gone.map((item) => <li key={item.id} className={cn('rounded-full border px-1.5 line-through', item.kind === 'conversation' && 'font-mono')}>{item.label}</li>)}</ul>
      </div>}
      {(!!bodies.length || srFiles.length > 0) && <section aria-label={t('task.materials.srSection')} className="space-y-2">{!picker && <h4 className="font-medium">{t('task.materials.srSection')}</h4>}
      {!!bodies.length && <div data-testid="materials-sr-bodies" className="space-y-2 border-t pt-2">
        <div className="flex items-center gap-1 font-medium">{t(picker ? 'task.materials.linkedSrBody' : 'task.materials.srBodies')}{!picker && <HelpTip text={t('task.materials.srBodiesHelp')} />}</div>
        {bodies.map((item) => <div key={item.srId} className="flex items-center gap-1 rounded-xl border p-2" data-testid={`sr-body-${item.srId}`}>
          <ClipboardList className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate"><span className="font-mono">{item.code}</span> · {item.title}</span>
          {item.used && <UsedMark />}
          <AttachToggle inputLabels attached={item.selected} label={item.code} disabled={disabled} onToggle={() => void run(item.selected ? removeSrInput(task.id, item.srId) : selectSrInput(task.id, item.srId))} />
        </div>)}
      </div>}
      {srFiles.length > 0 && <div data-testid="materials-sr-files" className="space-y-2 border-t pt-2">
        <div className="flex items-center gap-1 text-xs font-medium">{t(picker ? 'task.materials.linkedSrFiles' : 'task.materials.srFiles')}{!picker && <HelpTip text={t('task.materials.srFilesHelp')} />}</div>
        {srFiles.map((item) => <div key={item.file.id} className="flex items-center gap-1 rounded-xl border p-2" data-testid={`sr-file-${item.file.id}`}>
          <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setPreview(item.file)}>{item.file.name}{picker && ` v${item.file.version}`}</button><span className="truncate text-muted-foreground">{item.srCode} · {item.srTitle}</span>
          {isAiGenerated(item.file) && <Badge tone="violet">{t('components.aiGenerated')}</Badge>}
          <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted" aria-label={t('task.download')} onClick={() => void downloadBlob(item.file, t)}><Download className="size-3.5" /></button>
          {stage(item.file)}
        </div>)}
      </div>}
      </section>}
      {(!picker || ownFiles.length > 0) && <OwnFiles picker={picker} data-testid="materials-own" label={t('dropzone.toUpload')} disabled={disabled} onFiles={(files) => void upload(files)}><div className="space-y-2">
        <div className="font-medium">{t('task.materials.ownSection')}</div>
        <FileList showVersion={picker} files={ownFiles} canViewHistory={!picker} taskId={task.id} onPreview={setPreview} onToggleOutput={disabled || picker ? undefined : (fileId, isOutput) => void setOutputTag(actor, task.id, fileId, isOutput).catch((error: unknown) => toast.error(String(error)))} canDelete={!disabled && !picker} deletableBy={actor.userId} renderActions={stage} />
        {!disabled && !picker && <button type="button" className="flex w-full items-center justify-center gap-1 rounded-lg border p-1.5" onClick={() => uploadRef.current?.click()}><Upload className="size-3.5" />{t('task.materials.upload')}</button>}
        {!picker && !disabled && <input ref={uploadRef} type="file" multiple className="hidden" onChange={event => { void upload(event.target.files); event.target.value = '' }} />}
      </div></OwnFiles>}
      {picker && <input ref={uploadRef} type="file" multiple className="hidden" onChange={(event) => { void upload(event.target.files); event.target.value = '' }} />}
      {(!picker || shared.length > 0) && <div data-testid="materials-shared" className="space-y-2 border-t pt-2">
        <div className="font-medium">{t('task.materials.sharedSection')}</div>
        {!picker && <input aria-label={t('task.materials.searchShared')} placeholder={t('task.materials.searchPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border px-2 py-1" />}
        {candidates.isPending ? <p className="text-muted-foreground">{t('common.loading')}</p>
          : candidates.isError ? null
          : !shared.length && (search ? <div className="space-y-1 rounded-xl border border-dashed p-3 text-center text-muted-foreground"><p>{t('task.materials.noSearchResults', { query: search })}</p><button type="button" className="underline" onClick={() => setSearch('')}>{t('task.materials.clearSearch')}</button></div>
            : <div className="rounded-xl border border-dashed p-3 text-center text-muted-foreground">{t('task.materials.noShared')}</div>)}
        {candidates.isSuccess && sortedGroups.flatMap(([assistantId, items]) => [<div key={`group-${assistantId}`} className="pt-1 font-medium" data-testid={`shared-group-${assistantId}`}>{assistantById.get(assistantId)?.name ?? assistantId}</div>, ...items.sort((a, b) => a.file.name.localeCompare(b.file.name) || a.file.version - b.file.version).map((item) => <div key={item.file.id} className={cn('rounded-xl border p-2', fresh.has(item.file.id) && 'border-tone-info-fg/40 bg-tone-info-bg')} data-testid={`candidate-file-${item.file.id}`} data-fresh={fresh.has(item.file.id) ? 'true' : undefined}>
          <div className="flex items-center gap-1"><button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setPreview(item.file)}>{item.file.name}{picker && ` v${item.file.version}`}</button>{fresh.has(item.file.id) && <span className="shrink-0 text-[11px] text-tone-info-fg">{t('task.materials.fresh')}</span>}{stage(item.file)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{isAiGenerated(item.file) && <><Badge tone="violet">{t('components.aiGenerated')}</Badge> · </>}{item.role === 'output' ? <Badge tone="violet">{t('task.materials.roleOutput')}</Badge> : <Badge tone="neutral">{t('task.materials.roleUpload')}</Badge>} · <SourceLink taskId={item.sourceTaskId} code={item.sourceCode} title={item.sourceTitle} /> · {item.viaTags.join(', ')}
            {!!item.olderVersionIds?.length && <button type="button" className="ml-2 underline" onClick={() => setExpanded(expanded === item.file.id ? null : item.file.id)}>{t('task.materials.olderVersions', { count: item.olderVersionIds.length })}</button>}
          </div>
          {expanded === item.file.id && <OlderVersions file={item.file} attach={attach} onPreview={setPreview} />}
        </div>)])}
      </div>}
      {(!picker || conversations.length > 0) && <div data-tour="materials-conversations" className="space-y-2 border-t pt-2"><div className="flex items-center gap-1 text-sm font-semibold">{t('task.materials.sameTagConversations', { count: conversations.length })}{!picker && <HelpTip text={t('task.inputs.help')} />}</div><ConversationInputs taskId={task.id} candidates={conversations} disabled={disabled} fresh={fresh} /></div>}
      {picker && search && !shared.length && !ownFiles.length && !bodies.length && !srFiles.length && !conversations.length && candidates.isSuccess && own.isSuccess && srBodies.isSuccess && <p role="status">{t('task.materials.noSearchResults', { query: search })}</p>}
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

function OwnFiles({ picker, children, ...props }: { picker: boolean; children: ReactNode } & Omit<ComponentProps<typeof FileDropZone>, 'children'>) {
  return picker ? <div data-testid={props['data-testid']}>{children}</div> : <FileDropZone {...props}>{children}</FileDropZone>
}
