import { useT } from '@/i18n'
import { MODEL_SOURCE_KEY } from '@/lib/labels'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronDown, Cpu, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { resolveModel, type Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { setTaskModel } from '@/api/tasks'
import { getSettings } from '@/api/admin'
import { useActor } from '@/app/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useModelList } from '@/lib/useModelList'
import { cn } from '@/lib/utils'

/** 대화 모델 지정은 task.modelId에 저장한다. 스레드별 모델 지정은 S3에서 연결한다. */
export function ModelPicker({ task, assistant, disabled }: { task: Task; assistant: Assistant; disabled?: boolean }) {
  const t = useT()
  const actor = useActor()
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const { models, loading, reload, error } = useModelList()
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings }).data
  const resolved = resolveModel({ task, assistant, settings: { model: settings?.defaultModel ?? '' } })
  const current = task.modelId ?? ''
  const missingOnServer = models.length > 0 && !!resolved.modelId && !models.includes(resolved.modelId)
  async function choose(modelId: string) {
    setSaving(true)
    try {
      await setTaskModel(actor, task.id, modelId)
      toast.success(modelId ? t('chat.modelSet', { model: modelId }) : t('chat.modelCleared'))
      setOpen(false)
      setCustom('')
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : t('chat.modelSaveFailed')) }
    finally { setSaving(false) }
  }
  return <div className="relative inline-block">
    <button type="button" disabled={disabled} onClick={() => setOpen(!open)} className={cn('inline-flex h-6 items-center gap-1 rounded-full border bg-background px-1.5 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground', missingOnServer && 'border-amber-400 text-amber-700')} title={t('chat.changeModel')} aria-expanded={open}><Cpu className="size-3" />{resolved.modelId || t('chat.noModel')}<span className="text-xs opacity-70">{t(MODEL_SOURCE_KEY[resolved.source])}</span>{missingOnServer && <AlertTriangle className="size-3" />}<ChevronDown className="size-3 opacity-60" /></button>
    {open && <div className="absolute left-0 z-20 mt-1 w-[22rem] rounded-xl border bg-popover p-3 shadow-md">
      <div className="mb-2 flex items-center justify-between"><div className="text-xs font-semibold">{t('chat.assistantModel')}</div><Button variant="ghost" size="icon-xs" aria-label={t('chat.reloadModels')} onClick={() => void reload()} disabled={loading}><RefreshCw className={cn(loading && 'animate-spin')} /></Button></div>
      <div className="mb-2 rounded-xl border bg-muted/40 p-2 text-xs leading-relaxed text-muted-foreground"><span className={cn(current && 'font-semibold text-foreground')}>{t('chat.thisConversation')} <span className="font-mono">{current || '–'}</span></span><span className="mx-1 opacity-50">›</span><span className={cn(!current && assistant.modelId && 'font-semibold text-foreground')}>{t('chat.agentMapping')} <span className="font-mono">{assistant.modelId || '–'}</span></span></div>
      {missingOnServer && <p className="mb-2 rounded-xl border border-amber-300 bg-amber-50 p-1.5 text-xs text-amber-800">{t('chat.modelMissingBefore')} <code>{resolved.modelId}</code>{t('chat.modelMissingAfter')}</p>}
      <ul className="max-h-44 space-y-0.5 overflow-y-auto"><li><button type="button" disabled={saving} onClick={() => void choose('')} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-muted">{!current ? <Check className="size-3" /> : <span className="size-3" />}{t('chat.useDefaultModel')} <span className="text-muted-foreground">{t('chat.agentMappingHint')}</span></button></li>{models.map((model) => <li key={model}><button type="button" disabled={saving} onClick={() => void choose(model)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left font-mono text-xs hover:bg-muted">{current === model ? <Check className="size-3" /> : <span className="size-3" />}{model}</button></li>)}{!loading && (error || models.length === 0) && <li className="px-2 py-1 text-xs text-muted-foreground">{t('chat.noModels')}</li>}</ul>
      <form className="mt-2 flex gap-1" onSubmit={(event) => { event.preventDefault(); if (custom.trim()) void choose(custom.trim()) }}><Input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={t('chat.customModel')} className="h-7 font-mono text-xs" /><Button type="submit" size="sm" disabled={!custom.trim() || saving}>{t('chat.apply')}</Button></form>
    </div>}
  </div>
}
