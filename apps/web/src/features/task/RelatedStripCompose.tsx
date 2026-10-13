import { useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, X } from 'lucide-react'
import { composeInputs, type ComposeOp, type ComposeResult } from '@/api/compose'
import { filesForTask, getCandidates, type FileMeta } from '@/api/files'
import { getTask } from '@/api/tasks'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** 펼친 대화 1개에서 보여 줄 버전 체인 수 상한 — 나머지는 자료 탭에서 */
const MAX_CHAINS = 20

/** previousId 체인(루트)별로 묶는다 — 이름은 라벨로만 쓴다. 최신 버전이 앞, 최근에 갱신된 체인이 앞 */
function chainsOf(files: FileMeta[]) {
  const byId = new Map(files.map((file) => [file.id, file]))
  const rootOf = (file: FileMeta) => {
    let current = file
    const seen = new Set<string>()
    while (current.previousId && byId.has(current.previousId) && !seen.has(current.id)) { seen.add(current.id); current = byId.get(current.previousId)! }
    return current.id
  }
  const chains = new Map<string, FileMeta[]>()
  for (const file of files) chains.set(rootOf(file), [...(chains.get(rootOf(file)) ?? []), file])
  return [...chains].map(([root, versions]) => ({ root, versions: versions.sort((a, b) => b.version - a.version) }))
    .sort((a, b) => b.versions[0]!.uploadedAt.localeCompare(a.versions[0]!.uploadedAt))
}

export type Compose = ReturnType<typeof useCompose>

interface ComposeState {
  targetId?: string
  /** 고른 것 — 키(대화 c:… / 체인 f:…)별 현재 선택. 재시도도 이것을 다시 읽는다 */
  picks: ReadonlyMap<string, ComposeOp>
  results?: Array<ComposeResult & { key: string }>
  /** 방금 담긴 항목(키 → 대화·파일 ID) — 후보 재조회가 성공할 때까지 체크·비활성으로 잠근다 */
  locked: ReadonlyMap<string, string>
}
const fresh = (targetId?: string): ComposeState => ({ targetId, picks: new Map(), locked: new Map() })
const lockId = (op: ComposeOp) => op.kind === 'conversation' ? op.sourceTaskId : op.kind === 'file' ? op.fileId : op.toFileId

/**
 * 같은 태그 패널의 담기 상태 — 기본은 아무것도 고르지 않는다. 이미 담긴 대화·버전은 체크·비활성(덮어쓰기 없음),
 * 담긴 체인에서 다른 버전을 고르면 switch-version. 패널을 열 때만 대상 대화·후보를 조회한다.
 * 상태는 대상 대화별 — 다른 대화로 옮기면 선택·결과를 버린다.
 */
export function useCompose(targetId: string | undefined, open: boolean) {
  const client = useQueryClient()
  const enabled = open && !!targetId
  const target = useQuery({ queryKey: ['task', targetId], queryFn: () => getTask(targetId!), enabled })
  const candidates = useQuery({ queryKey: ['candidates', targetId], queryFn: () => getCandidates(targetId!), enabled })
  const [stored, setState] = useState(() => fresh(targetId))
  const state = stored.targetId === targetId ? stored : fresh(targetId)
  if (stored !== state) setState(state)
  const [running, setRunning] = useState(false)
  const inflight = useRef(false)
  const addedConversations = new Set(candidates.data?.conversations.filter((item) => item.selected).map((item) => item.taskId))
  const addedFiles = new Set(candidates.data?.files.filter((item) => item.selected).map((item) => item.file.id))
  const closed = target.data?.status === 'done'
  const disabled = !target.data || !candidates.data || closed || running
  const { picks, results, locked } = state
  const retryKeys = (results ?? []).filter((item) => item.status !== 'done' && picks.has(item.key)).map((item) => item.key)
  const change = (runTarget: string | undefined, apply: (current: ComposeState) => ComposeState) =>
    setState((current) => current.targetId === runTarget ? apply(current) : current)
  const update = (key: string, op: ComposeOp | null) => change(targetId, (current) => {
    const next = new Map(current.picks)
    if (op) next.set(key, op)
    else next.delete(key)
    return { ...current, picks: next }
  })
  async function run(keys: string[]) {
    const ops = keys.flatMap((key) => { const op = picks.get(key); return op ? [{ key, op }] : [] })
    if (!targetId || disabled || inflight.current || ops.length === 0) return
    const runTarget = targetId
    inflight.current = true
    setRunning(true)
    try {
      const outcome = await composeInputs(runTarget, ops.map((item) => item.op), client)
      const done = new Map(ops.filter((_, index) => outcome[index]!.status === 'done').map((item) => [item.key, lockId(item.op)]))
      change(runTarget, (current) => ({
        ...current,
        picks: new Map([...current.picks].filter(([key]) => !done.has(key))),
        results: outcome.map((item, index) => ({ ...item, key: ops[index]!.key })),
        locked: new Map([...current.locked, ...done]),
      }))
      if (done.size === 0) return
      // 담긴 것이 후보에 반영될 때까지 잠금 유지 — 재조회가 실패하면 잠금을 풀지 않는다
      const startedAt = Date.now()
      await client.refetchQueries({ queryKey: ['candidates', runTarget], exact: true })
      const confirmed = client.getQueryState(['candidates', runTarget])
      if (confirmed?.status === 'success' && confirmed.dataUpdatedAt >= startedAt) {
        change(runTarget, (current) => ({ ...current, locked: new Map([...current.locked].filter(([key, id]) => done.get(key) !== id)) }))
      }
    } finally { inflight.current = false; setRunning(false) }
  }
  return {
    disabled, closed, running, picks, results, locked, addedConversations, addedFiles, update,
    canRetry: !disabled && retryKeys.length > 0,
    submit: () => run([...picks.keys()]),
    retry: () => run(retryKeys),
  }
}

function FileChains({ taskId, compose }: { taskId: string; compose: Compose }) {
  const t = useT()
  const name = useId()
  const files = useQuery({ queryKey: ['files', taskId], queryFn: () => filesForTask(taskId) })
  if (files.isError) return <p role="alert" className="pl-9 text-destructive">{t('task.related.compose.filesFailed')}</p>
  if (!files.data) return <p className="pl-9 text-muted-foreground" aria-busy="true">{t('task.related.compose.filesLoading')}</p>
  const chains = chainsOf(files.data)
  if (chains.length === 0) return <p className="pl-9 text-muted-foreground">{t('task.related.compose.filesNone')}</p>
  return <div className="space-y-1 pl-9">
    {chains.slice(0, MAX_CHAINS).map(({ root, versions }) => {
      const key = `f:${taskId}:${root}`
      const label = versions[0]!.name
      const lockedId = compose.locked.get(key)
      const added = lockedId ? versions.find((file) => file.id === lockedId) : versions.find((file) => compose.addedFiles.has(file.id))
      const pick = compose.picks.get(key)
      const checked = pick?.kind === 'file' ? pick.fileId : pick?.kind === 'switch' ? pick.toFileId : added?.id
      const choose = (file: FileMeta) => compose.update(key, file.id === added?.id ? null
        : added ? { kind: 'switch', fromFileId: added.id, toFileId: file.id, label: `${file.name} v${file.version}` }
        : { kind: 'file', fileId: file.id, label: `${file.name} v${file.version}` })
      return <div key={root} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="max-w-full truncate">{label}</span>
        <div role="radiogroup" aria-label={t('task.related.compose.chain', { name: label })} className="flex flex-wrap gap-1.5">
          {versions.map((file) => <label key={file.id} className={cn('inline-flex items-center gap-0.5', file.id === added?.id && 'text-muted-foreground')}>
            <input type="radio" name={`${name}-${root}`} checked={checked === file.id} disabled={compose.disabled || file.id === added?.id} onChange={() => choose(file)} />
            {t('task.related.compose.version', { version: file.version })}
          </label>)}
        </div>
        {pick && <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={t('task.related.compose.clearLabel', { name: label })} onClick={() => compose.update(key, null)}><X className="size-3" /></button>}
      </div>
    })}
    {chains.length > MAX_CHAINS && <p className="text-muted-foreground">{t('task.related.compose.filesMore', { count: chains.length - MAX_CHAINS })}</p>}
  </div>
}

/** 행 아래 담기 조작 — 대화 본문(전체 스냅샷) 체크 + 파일 펼침(펼칠 때만 조회) */
export function ComposeRow({ taskId, code, compose }: { taskId: string; code: string; compose: Compose }) {
  const t = useT()
  const [filesOpen, setFilesOpen] = useState(false)
  const key = `c:${taskId}`
  const added = compose.addedConversations.has(taskId) || compose.locked.has(key)
  return <div className="space-y-1 px-2 pb-1.5 text-xs">
    <div className="flex items-center gap-3 pl-7">
      <label className="inline-flex items-center gap-1">
        <input type="checkbox" aria-label={t('task.related.compose.conversationLabel', { code })} checked={added || compose.picks.has(key)} disabled={added || compose.disabled}
          onChange={(event) => compose.update(key, event.target.checked ? { kind: 'conversation', sourceTaskId: taskId, label: code } : null)} />
        {t('task.related.compose.conversation')}
        {added && <span className="rounded-full border px-1 text-muted-foreground">{t('task.related.compose.added')}</span>}
      </label>
      <button type="button" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground" aria-expanded={filesOpen}
        aria-label={t('task.related.compose.filesLabel', { code })} onClick={() => setFilesOpen(!filesOpen)}>
        {t('task.related.compose.files')}<ChevronDown className={cn('size-3', filesOpen && 'rotate-180')} />
      </button>
    </div>
    {filesOpen && <FileChains taskId={taskId} compose={compose} />}
  </div>
}

/** 패널 하단 — 담기(순차) 버튼과 결과(성공·실패 사유·미처리)·재시도 */
export function ComposeBar({ compose }: { compose: Compose }) {
  const t = useT()
  const { results } = compose
  const count = (status: ComposeResult['status']) => results?.filter((item) => item.status === status).length ?? 0
  return <div className="space-y-1 border-t px-2 pt-1.5 pb-1 text-xs">
    <p className="text-muted-foreground">{compose.closed ? t('task.related.compose.closed') : t('task.related.compose.hint')}</p>
    <Button size="xs" disabled={compose.disabled || compose.picks.size === 0} onClick={() => void compose.submit()}>
      {compose.running ? t('task.related.compose.running') : t('task.related.compose.submit', { count: compose.picks.size })}
    </Button>
    {results && <div role="status" className="space-y-1">
      <p>{t('task.related.compose.summary', { done: count('done'), failed: count('failed'), pending: count('pending') })}</p>
      <ul aria-label={t('task.related.compose.results')}>{results.map((item, index) => <li key={index} className="flex items-center gap-1.5">
        <span className="truncate">{item.op.label}</span>
        <span className={cn('shrink-0', item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{item.status === 'done' ? t('task.related.compose.done')
          : item.status === 'failed' ? t('task.related.compose.failed', { reason: item.reason }) : t('task.related.compose.pending')}</span>
      </li>)}</ul>
      {count('failed') + count('pending') > 0 && <Button size="xs" variant="outline" disabled={!compose.canRetry} onClick={() => void compose.retry()}>{t('task.related.compose.retry')}</Button>}
    </div>}
  </div>
}
