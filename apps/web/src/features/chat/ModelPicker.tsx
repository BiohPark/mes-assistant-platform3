import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Cpu, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { MODEL_SOURCE_LABEL, resolveModel, type Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { setTaskModel } from '@/api/tasks'
import { useActor } from '@/app/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useModelList } from '@/lib/useModelList'
import { cn } from '@/lib/utils'

/** 대화 모델 지정은 task.modelId에 저장한다. 스레드별 모델 지정은 S3에서 연결한다. */
export function ModelPicker({ task, assistant, disabled }: { task: Task; assistant: Assistant; disabled?: boolean }) {
  const actor = useActor()
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const { models, loading, reload, error } = useModelList()
  const resolved = resolveModel({ task, assistant })
  const current = task.modelId ?? ''
  const missingOnServer = models.length > 0 && !!resolved.modelId && !models.includes(resolved.modelId)
  async function choose(modelId: string) {
    setSaving(true)
    try {
      await setTaskModel(actor, task.id, modelId)
      toast.success(modelId ? `이 대화 모델을 ${modelId}(으)로 설정했습니다.` : '이 대화 모델 지정을 해제했습니다.')
      setOpen(false)
      setCustom('')
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '모델을 저장하지 못했습니다') }
    finally { setSaving(false) }
  }
  return <div className="relative inline-block">
    <button type="button" disabled={disabled} onClick={() => setOpen(!open)} className={cn('inline-flex h-6 items-center gap-1 rounded-md border bg-background px-1.5 font-mono text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground', missingOnServer && 'border-amber-400 text-amber-700')} title="이 대화의 모델 변경" aria-expanded={open}><Cpu className="size-3" />{resolved.modelId || '(모델 없음)'}<span className="text-[9px] opacity-70">{MODEL_SOURCE_LABEL[resolved.source]}</span>{missingOnServer && <AlertTriangle className="size-3" />}<ChevronDown className="size-3 opacity-60" /></button>
    {open && <div className="absolute left-0 z-20 mt-1 w-[22rem] rounded-md border bg-popover p-3 shadow-md">
      <div className="mb-2 flex items-center justify-between"><div className="text-xs font-semibold">assistant 모델</div><Button variant="ghost" size="icon-xs" aria-label="모델 목록 새로고침" onClick={() => void reload()} disabled={loading}><RefreshCw className={cn(loading && 'animate-spin')} /></Button></div>
      <div className="mb-2 rounded-md border bg-muted/40 p-2 text-[10px] leading-relaxed text-muted-foreground"><span className={cn(current && 'font-semibold text-foreground')}>이 대화: <span className="font-mono">{current || '–'}</span></span><span className="mx-1 opacity-50">›</span><span className={cn(!current && assistant.modelId && 'font-semibold text-foreground')}>에이전트 매핑: <span className="font-mono">{assistant.modelId || '–'}</span></span></div>
      {missingOnServer && <p className="mb-2 rounded border border-amber-300 bg-amber-50 p-1.5 text-[11px] text-amber-800">현재 모델 <code>{resolved.modelId}</code>이(가) 서버 모델 목록에 없습니다.</p>}
      <ul className="max-h-44 space-y-0.5 overflow-y-auto"><li><button type="button" disabled={saving} onClick={() => void choose('')} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted">{!current ? <Check className="size-3" /> : <span className="size-3" />}지정 안 함 <span className="text-muted-foreground">(에이전트 매핑)</span></button></li>{models.map((model) => <li key={model}><button type="button" disabled={saving} onClick={() => void choose(model)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-muted">{current === model ? <Check className="size-3" /> : <span className="size-3" />}{model}</button></li>)}{!loading && (error || models.length === 0) && <li className="px-2 py-1 text-[11px] text-muted-foreground">모델 목록이 없습니다. 아래에 직접 입력하세요.</li>}</ul>
      <form className="mt-2 flex gap-1" onSubmit={(event) => { event.preventDefault(); if (custom.trim()) void choose(custom.trim()) }}><Input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="모델 ID 직접 입력" className="h-7 font-mono text-xs" /><Button type="submit" size="sm" disabled={!custom.trim() || saving}>적용</Button></form>
    </div>}
  </div>
}
