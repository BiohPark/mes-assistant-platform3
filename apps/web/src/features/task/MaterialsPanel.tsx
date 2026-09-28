import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpCircle, Upload } from 'lucide-react'
import type { Task } from '@mes/domain'
import { toast } from 'sonner'
import { getCandidates, filesForTask, fileVersions, setInput, setOutputTag, switchInputVersion, uploadFile, type FileMeta } from '@/api/files'
import { useActor } from '@/app/hooks'
import { FileList } from './FileList'
import { FilePreviewDialog } from './FilePreviewDialog'
import { InputToggle } from './InputToggle'

type Tab = 'inputs' | 'shared' | 'own'
export function MaterialsPanel({ task }: { task: Task }) {
  const actor = useActor()
  const uploadRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('inputs')
  const [preview, setPreview] = useState<FileMeta | null>(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const candidates = useQuery({ queryKey: ['candidates', task.id], queryFn: () => getCandidates(task.id) })
  const own = useQuery({ queryKey: ['files', task.id], queryFn: () => filesForTask(task.id) })
  const byId = new Map([...(candidates.data?.files ?? []).map((item) => [item.file.id, item.file] as const), ...(own.data ?? []).map((file) => [file.id, file] as const)])
  const selection = [...task.inputs].sort((a, b) => a.weight === b.weight ? 0 : a.weight === 'main' ? -1 : 1)
  const shared = (candidates.data?.files ?? []).filter((item) => item.sourceTaskId !== task.id && item.viaTags.length && !item.newerVersionId && item.file.name.toLowerCase().includes(search.toLowerCase()))
  const disabled = task.status === 'done'
  async function change(fileId: string, weight: 'main' | 'reference' | null) {
    try { await setInput(actor, task.id, fileId, weight) }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  async function upload(list: FileList | null) {
    if (!list?.length) return
    try {
      for (const file of Array.from(list)) await uploadFile(actor, { taskId: task.id }, file)
      toast.success(`${list.length}개 파일을 업로드했습니다.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  return <div className="space-y-3 text-xs" data-testid="materials-panel">
    <div role="tablist" aria-label="자료 탭" className="flex gap-1 border-b pb-2">
      {([['inputs', 'AI 입력'], ['shared', '공유 자료함'], ['own', '이 대화 파일']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`rounded px-2 py-1 ${tab === value ? 'bg-muted font-medium' : ''}`}>{label}</button>)}
    </div>
    {(candidates.isError || own.isError) && <div role="alert">자료를 불러오지 못했습니다. <button type="button" className="underline" onClick={() => { void candidates.refetch(); void own.refetch() }}>다시 시도</button></div>}
    {tab === 'inputs' && <div data-testid="materials-inputs" className="space-y-2">
      <p className="text-muted-foreground">선택한 파일만 AI 입력에 남습니다. ★ 주 입력 · ☑ 참고</p>
      {!selection.length && <div className="rounded border border-dashed p-3 text-center text-muted-foreground">선택한 파일이 없습니다.</div>}
      {selection.map((input) => {
        const file = byId.get(input.fileId)
        if (!file) return null
        const newerVersionId = candidates.data?.files.find((item) => item.file.id === file.id)?.newerVersionId
        return <div key={file.id} className="rounded border p-2" data-testid={`selected-file-${file.id}`}>
          <div className="flex items-center gap-2"><button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setPreview(file)}>{file.name} v{file.version}</button><InputToggle weight={input.weight} label={file.name} disabled={disabled} onChange={(weight) => void change(file.id, weight)} /></div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground"><span>{input.weight === 'main' ? '주 입력' : '참고'} · {file.originTaskId === task.id ? '이 대화' : file.originTaskId}</span>
            {newerVersionId && !disabled && <button type="button" className="inline-flex items-center gap-1 rounded border border-sky-300 px-1 text-sky-700" onClick={() => void switchInputVersion(actor, task.id, file.id, newerVersionId).catch((error: unknown) => toast.error(String(error)))}><ArrowUpCircle className="size-3" />새 버전 있음 · 바꾸기</button>}
          </div>
        </div>
      })}
    </div>}
    {tab === 'shared' && <div data-testid="materials-shared" className="space-y-2">
      <input aria-label="공유 자료함 검색" placeholder="파일 이름으로 찾기" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded border px-2 py-1" />
      {!shared.length && <div className="rounded border border-dashed p-3 text-center text-muted-foreground">같은 태그 대화의 파일이 없습니다.</div>}
      {shared.map((item) => <div key={item.file.id} className="rounded border p-2" data-testid={`candidate-file-${item.file.id}`}>
        <div className="flex items-center gap-1"><button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setPreview(item.file)}>{item.file.name} v{item.file.version}</button><InputToggle weight={task.inputs.find((input) => input.fileId === item.file.id)?.weight} label={item.file.name} disabled={disabled} onChange={(weight) => void change(item.file.id, weight)} /></div>
        <div className="mt-1 text-[10px] text-muted-foreground">{item.role === 'output' ? '산출물' : '업로드'} · <a href={`/c/${item.sourceTaskId}`} className="underline">{item.sourceTaskId}</a> · {item.viaTags.join(', ')}
          {!!item.olderVersionIds?.length && <button type="button" className="ml-2 underline" onClick={() => setExpanded(expanded === item.file.id ? null : item.file.id)}>이전 버전 {item.olderVersionIds.length}</button>}
        </div>
        {expanded === item.file.id && <OlderVersions file={item.file} task={task} disabled={disabled} onPreview={setPreview} onChange={change} />}
      </div>)}
    </div>}
    {tab === 'own' && <div data-testid="materials-own" className="space-y-2">
      <FileList files={own.data ?? []} taskId={task.id} onPreview={setPreview} onToggleOutput={disabled ? undefined : (fileId, isOutput) => void setOutputTag(actor, task.id, fileId, isOutput).catch((error: unknown) => toast.error(String(error)))} canDelete={!disabled} renderActions={(file) => <InputToggle weight={task.inputs.find((input) => input.fileId === file.id)?.weight} label={file.name} disabled={disabled} onChange={(weight) => void change(file.id, weight)} />} />
      {!disabled && <><button type="button" className="flex w-full items-center justify-center gap-1 rounded border p-1.5" onClick={() => uploadRef.current?.click()}><Upload className="size-3.5" />파일 업로드</button><input ref={uploadRef} type="file" multiple className="hidden" onChange={(event) => { void upload(event.target.files); event.target.value = '' }} /></>}
    </div>}
    <FilePreviewDialog file={preview} onClose={() => setPreview(null)} />
  </div>
}

function OlderVersions({ file, task, disabled, onPreview, onChange }: { file: FileMeta; task: Task; disabled: boolean; onPreview: (file: FileMeta) => void; onChange: (fileId: string, weight: 'main' | 'reference' | null) => Promise<void> }) {
  const versions = useQuery({ queryKey: ['file-versions', file.id], queryFn: () => fileVersions(file.id) })
  return <ul className="mt-2 space-y-1 border-l pl-2">{versions.data?.filter((version) => version.id !== file.id).map((version) => <li key={version.id} className="flex items-center gap-1">
    <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onPreview(version)}>{version.name} v{version.version}</button>
    <InputToggle weight={task.inputs.find((input) => input.fileId === version.id)?.weight} label={`${version.name} v${version.version}`} disabled={disabled} onChange={(weight) => void onChange(version.id, weight)} />
  </li>)}</ul>
}
