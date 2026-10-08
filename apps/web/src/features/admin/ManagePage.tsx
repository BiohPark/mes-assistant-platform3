import { useT } from '@/i18n'
import { useModelList } from '@/lib/useModelList'
import { newId } from '@/lib/ids'
import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Assistant } from '@mes/contracts'
import { toast } from 'sonner'
import { TopBar } from '@/app/TopBar'
import { useAssistants, useUsers } from '@/app/hooks'
import { CodeInput } from '@/components/CodeInput'
import { Chip } from '@/components/Chip'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createAssistant, deleteAssistant, listManagedCodes, saveOrder, updateAssistant, updateCode, uploadImage, type AssistantInput } from '@/api/admin'

const empty = (ownerId: string): AssistantInput => ({ name: '', level1: '', level2: '', summary: '', ownerId,
  status: 'open', usageExample: '', modelId: '', link1: '', docUrl: '', expectedInputs: [], expectedOutputs: [],
  checklistTemplate: [['입력 자료 선택', true], ['결과 검토', true], ['산출물 저장', false]].map(([label, required]) => ({ id: newId(), label: String(label), required: Boolean(required) })) })
const fromAssistant = (row: Assistant): AssistantInput => ({ id: row.id, name: row.name, level1: row.level1,
  level2: row.level2, summary: row.summary, ownerId: row.ownerId, status: row.status,
  usageExample: row.usageExample, modelId: row.modelId ?? '', link1: row.link1 ?? '', docUrl: row.docUrl ?? '',
  expectedInputs: row.expectedInputs, expectedOutputs: row.expectedOutputs, checklistTemplate: row.checklistTemplate })
const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean)

function ImageDropzone({ assistant, onSaved }: { assistant: Assistant; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  async function save(file: File | null) {
    setBusy(true)
    try { await uploadImage(assistant.id, file); onSaved(); toast.success('이미지를 저장했습니다') }
    catch (error) { toast.error(error instanceof Error ? error.message : '이미지 저장 실패') }
    finally { setBusy(false) }
  }
  return <div className="flex items-center gap-2 rounded-xl border border-dashed p-2 text-xs" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void save(file) }}>
    <AssistantAvatar assistant={assistant} size="md" />
    <label className="cursor-pointer rounded-lg border px-2 py-1">이미지 선택 또는 여기로 끌기<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void save(file) }} /></label>
    {assistant.imageId && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void save(null)}>이미지 제거</Button>}
  </div>
}

function AssistantEditorSheet({ assistant, onClose, onSaved }: { assistant?: Assistant; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const { models } = useModelList()
  const users = useUsers()
  const assistants = useAssistants()
  const codes = useQuery({ queryKey: ['managed-codes'], queryFn: listManagedCodes }).data ?? []
  const [form, setForm] = useState<AssistantInput>(() => assistant ? fromAssistant(assistant) : empty(users[0]?.id ?? ''))
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!assistant && !form.ownerId && users[0]) setForm((current) => ({ ...current, ownerId: users[0]!.id })) }, [assistant, form.ownerId, users])
  function change<K extends keyof AssistantInput>(field: K, value: AssistantInput[K]) { setForm((current) => ({ ...current, [field]: value })) }
  function moveChecklist(index: number, step: -1 | 1) {
    const next = [...form.checklistTemplate]
    const other = index + step
    if (other < 0 || other >= next.length) return
    ;[next[index], next[other]] = [next[other]!, next[index]!]
    change('checklistTemplate', next)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.level1 || !form.level2) { toast.error(t('admin.codesRequired')); return }
    setBusy(true)
    try {
      if (assistant) {
        const { id: _id, ...patch } = form; void _id
        for (const level of ['level1', 'level2'] as const) {
          if (patch[level] === assistant[level]) {
            delete patch[level]
            patch[`${level}CodeId`] = assistant[`${level}CodeId`]
          }
        }
        await updateAssistant(assistant.id, patch)
      }
      else await createAssistant(form)
      onSaved(); onClose(); toast.success('에이전트를 저장했습니다')
    } catch (error) { toast.error(error instanceof Error ? error.message : '저장 실패') }
    finally { setBusy(false) }
  }
  return <div role="dialog" aria-label="에이전트 편집" className="fixed inset-0 z-50 flex justify-end bg-black/30">
    <div className="h-full w-full max-w-xl overflow-auto bg-background p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">{assistant ? '에이전트 수정' : '새 에이전트'}</h2><Button variant="ghost" onClick={onClose}>닫기</Button></div>
      <form onSubmit={(event) => void submit(event)} className="space-y-3 text-sm">
        <label className="block">이름<Input value={form.name} onChange={(event) => change('name', event.target.value)} required /></label>
        {(['level1', 'level2'] as const).map((level) => <div key={level}>
          <div className="mb-1">{t(level === 'level1' ? 'admin.level1' : 'admin.level2')}</div>
          <CodeInput group={`assistant_${level}`} codes={codes} assistants={assistants} level1={form.level1}
            value={form[level] ?? ''} onChange={value => change(level, value)} aria-label={t(level === 'level1' ? 'admin.level1' : 'admin.level2')} />
        </div>)}
        <label className="block">담당자<select className="w-full rounded-lg border bg-background p-2" value={form.ownerId} required onChange={(event) => change('ownerId', event.target.value)}><option value="">선택</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        <label className="block">상태<select className="w-full rounded-lg border bg-background p-2" value={form.status} onChange={(event) => change('status', event.target.value as AssistantInput['status'])}>{(['open', 'developing', 'testing', 'retired'] as const).map((value) => <option key={value} value={value}>{t(`status.assistant.${value}`)}</option>)}</select></label>
        <label className="block">{t('admin.connectedModel')}<Input list="assistant-models" value={form.modelId ?? ''} onChange={(event) => change('modelId', event.target.value)} /><datalist id="assistant-models">{models.map((model) => <option key={model} value={model} />)}</datalist></label>
        <label className="block">{t('admin.openWebUiLink')}<Input value={form.link1 ?? ''} onChange={(event) => change('link1', event.target.value)} /></label>
        <label className="block">{t('admin.documentUrl')}<Input value={form.docUrl ?? ''} onChange={(event) => change('docUrl', event.target.value)} /></label>
        <label className="block">설명<textarea className="w-full rounded-lg border bg-background p-2" value={form.summary} onChange={(event) => change('summary', event.target.value)} /></label>
        <label className="block">{t('admin.firstQuestionExamples')}<textarea className="w-full rounded-lg border bg-background p-2" value={form.usageExample} onChange={(event) => change('usageExample', event.target.value)} /></label>
        {(['expectedInputs', 'expectedOutputs'] as const).map((field) => <label key={field} className="block">{field === 'expectedInputs' ? '기대 입력' : '기대 출력'} (줄마다 한 항목)<textarea className="w-full rounded-lg border bg-background p-2" value={form[field].join('\n')} onChange={(event) => change(field, lines(event.target.value))} /></label>)}
        <fieldset className="space-y-2"><legend>체크리스트 기본값</legend>{form.checklistTemplate.map((item, index) => <div key={item.id} className="flex gap-2"><Input aria-label={`체크리스트 ${index + 1}`} value={item.label} onChange={(event) => change('checklistTemplate', form.checklistTemplate.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry))} /><label className="flex items-center gap-1"><input type="checkbox" checked={item.required} onChange={(event) => change('checklistTemplate', form.checklistTemplate.map((entry, i) => i === index ? { ...entry, required: event.target.checked } : entry))} />필수</label><Button type="button" variant="outline" disabled={index === 0} onClick={() => moveChecklist(index, -1)}>↑</Button><Button type="button" variant="outline" disabled={index === form.checklistTemplate.length - 1} onClick={() => moveChecklist(index, 1)}>↓</Button><Button type="button" variant="outline" onClick={() => change('checklistTemplate', form.checklistTemplate.filter((_, i) => i !== index))}>삭제</Button></div>)}<Button type="button" variant="outline" onClick={() => change('checklistTemplate', [...form.checklistTemplate, { id: newId(), label: '', required: false }])}>항목 추가</Button></fieldset>
        {assistant && <ImageDropzone assistant={assistant} onSaved={onSaved} />}
        <div className="flex gap-2"><Button type="submit" disabled={busy}>저장</Button>{assistant && <Button type="button" variant="destructive" disabled={busy} onClick={() => { if (window.confirm('에이전트를 삭제할까요?')) void deleteAssistant(assistant.id).then(() => { onSaved(); onClose() }, (error: unknown) => toast.error(error instanceof Error ? error.message : '삭제 실패')) }}>삭제</Button>}</div>
      </form>
    </div>
  </div>
}

function AssistantTable({ rows, onEdit, onSaved }: { rows: Assistant[]; onEdit: (row: Assistant) => void; onSaved: () => void }) {
  const t = useT()
  const [saving, setSaving] = useState<string | null>(null)
  return <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/50"><tr><th className="p-2">에이전트</th><th className="p-2">분류</th><th className="p-2">상태</th><th className="p-2">{t('admin.connectedModel')}</th><th className="p-2">관리</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="flex items-center gap-2 p-2"><AssistantAvatar assistant={row} size="sm" /><span>{row.name}</span></td><td className="p-2">{row.level1} / {row.level2}</td><td className="p-2">{t(`status.assistant.${row.status}`)}</td><td className="p-2"><Input aria-label={t('admin.agentModel', { name: row.name })} defaultValue={row.modelId ?? ''} key={`${row.id}-${row.revision}`} onBlur={(event) => { const modelId = event.target.value.trim(); if (modelId === (row.modelId ?? '')) return; setSaving(row.id); void updateAssistant(row.id, { modelId }).then(() => { onSaved(); toast.success(t('admin.modelSaved')) }, (error: unknown) => toast.error(error instanceof Error ? error.message : '저장 실패')).finally(() => setSaving(null)) }} disabled={saving === row.id} /></td><td className="p-2"><Button size="sm" variant="outline" onClick={() => onEdit(row)}>편집</Button></td></tr>)}</tbody></table></div>
}

function SortableAssistantGrid({ rows, onSaved }: { rows: Assistant[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<Assistant[] | null>(null)
  const [busy, setBusy] = useState(false)
  const ordered = draft ?? rows
  return <div className="space-y-3"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setDraft([...rows])} disabled={!!draft || rows.length === 0}>순서 편집</Button>{draft && <><Button size="sm" disabled={busy} onClick={() => { setBusy(true); void saveOrder(draft).then(() => { setDraft(null); onSaved(); toast.success('순서를 저장했습니다') }, (error: unknown) => { toast.error(error instanceof Error ? error.message : '순서 충돌'); setDraft(null); onSaved() }).finally(() => setBusy(false)) }}>저장</Button><Button size="sm" variant="outline" onClick={() => setDraft(null)}>취소</Button></>}</div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{ordered.map((row) => <div key={row.id} draggable={!!draft} onDragStart={(event) => event.dataTransfer.setData('text/plain', row.id)} onDragOver={(event) => { if (draft) event.preventDefault() }} onDrop={(event) => { if (!draft) return; event.preventDefault(); const source = event.dataTransfer.getData('text/plain'); const next = [...draft]; const old = next.findIndex((item) => item.id === source); const to = next.findIndex((item) => item.id === row.id); if (old < 0 || to < 0) return; next.splice(to, 0, next.splice(old, 1)[0]!); setDraft(next) }} className={`flex items-center gap-2 rounded-xl border bg-card p-2 ${draft ? 'cursor-grab' : ''}`}><AssistantAvatar assistant={row} size="sm" /><span>{row.order}. {row.name}</span></div>)}</div>
  </div>
}

function CodesPanel() {
  const t = useT()
  const client = useQueryClient()
  const assistants = useAssistants()
  const query = useQuery({ queryKey: ['managed-codes'], queryFn: listManagedCodes })
  const save = (id: string, patch: Parameters<typeof updateCode>[1]) => void updateCode(id, patch).then(() => { void query.refetch(); void client.invalidateQueries({ queryKey: ['assistants'] }) },
    (error: unknown) => toast.error(error instanceof Error ? error.message : t('admin.codeSaveFailed')))
  return <div className="space-y-4">{(['assistant_level1', 'assistant_level2'] as const).map(group => <section key={group} className="space-y-2">
    <h2 className="text-sm font-semibold">{t(group === 'assistant_level1' ? 'admin.level1' : 'admin.level2')}</h2>
    {query.data?.filter(item => item.groupKey === group).map(item => <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-2 text-sm">
      <Input className="min-w-32 flex-1" aria-label={t('admin.codeName', { name: item.name })} defaultValue={item.name} key={`${item.id}-${item.name}`} onBlur={event => { if (event.target.value !== item.name) save(item.id, { name: event.target.value }) }} />
      <Input className="w-20" type="number" aria-label={t('admin.codeOrder', { name: item.name })} defaultValue={item.sortOrder} onBlur={event => { const sortOrder = Number(event.target.value); if (sortOrder !== item.sortOrder) save(item.id, { sortOrder }) }} />
      <label className="flex items-center gap-1"><input type="checkbox" checked={item.active} onChange={event => save(item.id, { active: event.target.checked })} />{t('admin.codeActive')}</label>
      <Chip label={t('admin.codeUsage', { count: assistants.filter(row => (group === 'assistant_level1' ? row.level1CodeId : row.level2CodeId) === item.id).length })} />
      {item.isAuto && <Chip label={t('admin.codeAuto')} />}
    </div>)}
  </section>)}</div>
}

export function ManagePage() {
  const rows = useAssistants()
  const client = useQueryClient()
  const users = useUsers()
  const [tab, setTab] = useState<'assistants' | 'codes'>('assistants')
  const [editor, setEditor] = useState<Assistant | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  const filtered = sorted.filter((row) => `${row.name} ${row.level1} ${row.level2}`.toLowerCase().includes(search.toLowerCase()))
  const refresh = () => { void client.invalidateQueries({ queryKey: ['assistants'] }); void client.invalidateQueries({ queryKey: ['managed-codes'] }) }
  useEffect(() => { if (editor === 'new' && users.length === 0) void client.invalidateQueries({ queryKey: ['users'] }) }, [editor, users.length, client])
  return <><TopBar title="에이전트 관리" actions={<Button size="sm" onClick={() => setEditor('new')}>새 에이전트</Button>} /><div className="flex-1 space-y-4 overflow-auto p-4 lg:p-6"><div className="flex gap-2"><Button variant={tab === 'assistants' ? 'default' : 'outline'} onClick={() => setTab('assistants')}>에이전트</Button><Button variant={tab === 'codes' ? 'default' : 'outline'} onClick={() => setTab('codes')}>분류 코드</Button></div>{tab === 'codes' ? <CodesPanel /> : <><Input className="max-w-xs" placeholder="에이전트 검색" value={search} onChange={(event) => setSearch(event.target.value)} /><AssistantTable rows={filtered} onEdit={setEditor} onSaved={refresh} />{!search && <SortableAssistantGrid rows={sorted} onSaved={refresh} />}</>}</div>{editor && <AssistantEditorSheet key={editor === 'new' ? 'new' : editor.id} assistant={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={refresh} />}</>
}
