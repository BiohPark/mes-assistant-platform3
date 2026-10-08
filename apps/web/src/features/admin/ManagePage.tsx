import { useT, type Translator } from '@/i18n'
import { useModelList } from '@/lib/useModelList'
import { newId } from '@/lib/ids'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Assistant } from '@mes/contracts'
import { toast } from 'sonner'
import { TopBar } from '@/app/TopBar'
import { useAssistants, useUsers } from '@/app/hooks'
import { PersonPicker } from '@/components/PersonPicker'
import { Field } from '@/components/Field'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Switch } from '@/components/ui/switch'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CodeInput } from '@/components/CodeInput'
import { Chip } from '@/components/Chip'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createAssistant, deleteAssistant, listManagedCodes, saveOrder, updateAssistant, updateCode, uploadImage, type AssistantInput } from '@/api/admin'

const empty = (ownerId: string, t: Translator): AssistantInput => ({ name: '', level1: '', level2: '', summary: '', ownerId,
  status: 'open', usageExample: '', modelId: '', link1: '', docUrl: '', expectedInputs: [], expectedOutputs: [],
  checklistTemplate: [[t('admin.manage.defaultChecklist.selectInputs'), true], [t('admin.manage.defaultChecklist.reviewResult'), true], [t('admin.manage.defaultChecklist.saveOutput'), false]].map(([label, required]) => ({ id: newId(), label: String(label), required: Boolean(required) })) })
const fromAssistant = (row: Assistant): AssistantInput => ({ id: row.id, name: row.name, level1: row.level1,
  level2: row.level2, summary: row.summary, ownerId: row.ownerId, status: row.status,
  usageExample: row.usageExample, modelId: row.modelId ?? '', link1: row.link1 ?? '', docUrl: row.docUrl ?? '',
  expectedInputs: row.expectedInputs, expectedOutputs: row.expectedOutputs, checklistTemplate: row.checklistTemplate })
const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean)

function ImageDropzone({ assistant, onSaved }: { assistant: Assistant; onSaved: () => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  async function save(file: File | null) {
    setBusy(true)
    try { await uploadImage(assistant.id, file); onSaved(); toast.success(t('admin.manage.imageSaved')) }
    catch (error) { toast.error(error instanceof Error ? error.message : t('admin.manage.imageSaveFailed')) }
    finally { setBusy(false) }
  }
  return <div className="flex items-center gap-2 rounded-xl border border-dashed p-2 text-xs" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void save(file) }}>
    <AssistantAvatar assistant={assistant} size="md" />
    <Field label={t('admin.manage.imageDrop')} className="[&>label]:cursor-pointer [&>label]:rounded-lg [&>label]:border [&>label]:px-2 [&>label]:py-1"><input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void save(file) }} /></Field>
    {assistant.imageId && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void save(null)}>{t('admin.manage.imageRemove')}</Button>}
  </div>
}

function AssistantEditorSheet({ assistant, onClose, onSaved, onCloseAutoFocus }: { assistant?: Assistant; onClose: () => void; onSaved: () => void; onCloseAutoFocus: (event: Event) => void }) {
  const t = useT()
  const { models } = useModelList()
  const users = useUsers()
  const assistants = useAssistants()
  const codes = useQuery({ queryKey: ['managed-codes'], queryFn: listManagedCodes }).data ?? []
  const [form, setForm] = useState<AssistantInput>(() => assistant ? fromAssistant(assistant) : empty(users[0]?.id ?? '', t))
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deleteTrigger = useRef<HTMLButtonElement>(null)
  const ownerTouched = useRef(false)
  const [ownerInvalid, setOwnerInvalid] = useState(false)
  const peopleSource = useCallback(() => users.map(user => ({ value: user.id, label: user.name })), [users])
  const owner = users.find(user => user.id === form.ownerId)
  useEffect(() => { if (!assistant && !ownerTouched.current && !form.ownerId && users[0]) setForm((current) => ({ ...current, ownerId: users[0]!.id })) }, [assistant, form.ownerId, users])
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
    if (!form.ownerId) { setOwnerInvalid(true); toast.error(t('admin.ownerRequired')); return }
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
      onSaved(); onClose(); toast.success(t('admin.manage.assistantSaved'))
    } catch (error) { toast.error(error instanceof Error ? error.message : t('admin.saveFailed')) }
    finally { setBusy(false) }
  }
  return <Sheet open onOpenChange={open => { if (!open) onClose() }}>
    <SheetContent side="right" className="w-full sm:max-w-xl" aria-label={t('admin.manage.editorLabel')} aria-labelledby={undefined} aria-modal="true" aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
      <SheetHeader><SheetTitle>{assistant ? t('admin.manage.editTitle') : t('admin.manage.newAssistant')}</SheetTitle></SheetHeader>
      <form onSubmit={(event) => void submit(event)} className="space-y-3 text-sm">
        <Field label={t('admin.name')}><Input value={form.name} onChange={(event) => change('name', event.target.value)} required /></Field>
        {(['level1', 'level2'] as const).map((level) => <Field key={level} label={t(level === 'level1' ? 'admin.level1' : 'admin.level2')}>
          <CodeInput group={`assistant_${level}`} codes={codes} assistants={assistants} level1={form.level1}
            value={form[level] ?? ''} onChange={value => change(level, value)} aria-label={t(level === 'level1' ? 'admin.level1' : 'admin.level2')} />
        </Field>)}
        <Field label={t('admin.owner')} error={ownerInvalid ? t('admin.ownerRequired') : undefined}><PersonPicker mode="single" source={peopleSource}
          value={owner ? { value: owner.id, label: owner.name } : null} aria-label={t('admin.owner')} aria-required aria-invalid={ownerInvalid}
          onChange={person => { ownerTouched.current = true; change('ownerId', person?.value ?? ''); setOwnerInvalid(false) }} /></Field>
        <Field label={t('admin.assistantStatus')}><ToggleGroup type="single" variant="outline" size="sm" value={form.status} aria-label={t('admin.assistantStatus')}
          onValueChange={value => { if (value) change('status', value as AssistantInput['status']) }} className="flex-wrap">
          {(['open', 'developing', 'testing', 'retired'] as const).map(value => <ToggleGroupItem key={value} value={value}>
            <span aria-hidden className={`size-2 rounded-full ${{ open: 'bg-tone-success-fg', developing: 'bg-tone-warning-fg', testing: 'bg-tone-info-fg', retired: 'bg-tone-neutral-fg' }[value]}`} />{t(`status.assistant.${value}`)}
          </ToggleGroupItem>)}
        </ToggleGroup></Field>
        <Field label={t('admin.connectedModel')}><Input list="assistant-models" value={form.modelId ?? ''} onChange={(event) => change('modelId', event.target.value)} /></Field><datalist id="assistant-models">{models.map((model) => <option key={model} value={model} />)}</datalist>
        <Field label={t('admin.openWebUiLink')}><Input value={form.link1 ?? ''} onChange={(event) => change('link1', event.target.value)} /></Field>
        <Field label={t('admin.documentUrl')}><Input value={form.docUrl ?? ''} onChange={(event) => change('docUrl', event.target.value)} /></Field>
        <Field label={t('admin.manage.summary')}><textarea className="w-full rounded-lg border bg-background p-2" value={form.summary} onChange={(event) => change('summary', event.target.value)} /></Field>
        <Field label={t('admin.firstQuestionExamples')}><textarea className="w-full rounded-lg border bg-background p-2" value={form.usageExample} onChange={(event) => change('usageExample', event.target.value)} /></Field>
        {(['expectedInputs', 'expectedOutputs'] as const).map((field) => <Field key={field} label={t(field === 'expectedInputs' ? 'admin.manage.expectedInputs' : 'admin.manage.expectedOutputs')}><textarea className="w-full rounded-lg border bg-background p-2" value={form[field].join('\n')} onChange={(event) => change(field, lines(event.target.value))} /></Field>)}
        <fieldset className="space-y-2"><legend>{t('admin.manage.checklistDefaults')}</legend>{form.checklistTemplate.map((item, index) => <div key={item.id} className="flex gap-2"><Field label={t('admin.manage.checklistItem', { number: String(index + 1) })} className="min-w-0 flex-1 [&>label]:sr-only"><Input aria-label={t('admin.manage.checklistItem', { number: String(index + 1) })} value={item.label} onChange={(event) => change('checklistTemplate', form.checklistTemplate.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry))} /></Field><Field label={t('admin.checklistRequired')} className="flex-row items-center gap-1 [&>label]:order-last"><Checkbox aria-label={t('admin.requiredItem', { name: item.label || String(index + 1) })} checked={item.required} onCheckedChange={(checked) => change('checklistTemplate', form.checklistTemplate.map((entry, i) => i === index ? { ...entry, required: checked === true } : entry))} /></Field><Button type="button" variant="outline" disabled={index === 0} onClick={() => moveChecklist(index, -1)}>↑</Button><Button type="button" variant="outline" disabled={index === form.checklistTemplate.length - 1} onClick={() => moveChecklist(index, 1)}>↓</Button><Button type="button" variant="outline" onClick={() => change('checklistTemplate', form.checklistTemplate.filter((_, i) => i !== index))}>{t('admin.manage.delete')}</Button></div>)}<Button type="button" variant="outline" onClick={() => change('checklistTemplate', [...form.checklistTemplate, { id: newId(), label: '', required: false }])}>{t('admin.manage.addItem')}</Button></fieldset>
        {assistant && <ImageDropzone assistant={assistant} onSaved={onSaved} />}
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{t('admin.save')}</Button>{assistant && <Button ref={deleteTrigger} type="button" variant="destructive" disabled={busy} onClick={() => setDeleteOpen(true)}>{t('admin.manage.delete')}</Button>}</div>
      </form>
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t('admin.manage.deleteConfirm')}
        confirmLabel={t('admin.manage.delete')} onCloseAutoFocus={event => { event.preventDefault(); deleteTrigger.current?.focus() }}
        onConfirm={async () => {
          if (!assistant) return
          try { await deleteAssistant(assistant.id); onSaved(); onClose() }
          catch (error) { toast.error(error instanceof Error ? error.message : t('admin.manage.deleteFailed')) }
        }} />
    </SheetContent>
  </Sheet>
}

function AssistantTable({ rows, onEdit, onSaved }: { rows: Assistant[]; onEdit: (row: Assistant) => void; onSaved: () => void }) {
  const t = useT()
  const [saving, setSaving] = useState<string | null>(null)
  return <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/50"><tr><th className="p-2">{t('admin.manage.assistant')}</th><th className="p-2">{t('admin.manage.category')}</th><th className="p-2">{t('admin.assistantStatus')}</th><th className="p-2">{t('admin.connectedModel')}</th><th className="p-2">{t('admin.manage.actions')}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="flex items-center gap-2 p-2"><AssistantAvatar assistant={row} size="sm" /><span>{row.name}</span></td><td className="p-2">{row.level1} / {row.level2}</td><td className="p-2">{t(`status.assistant.${row.status}`)}</td><td className="p-2"><Field label={t('admin.agentModel', { name: row.name })} className="[&>label]:sr-only"><Input aria-label={t('admin.agentModel', { name: row.name })} defaultValue={row.modelId ?? ''} key={`${row.id}-${row.revision}`} onBlur={(event) => { const modelId = event.target.value.trim(); if (modelId === (row.modelId ?? '')) return; setSaving(row.id); void updateAssistant(row.id, { modelId }).then(() => { onSaved(); toast.success(t('admin.modelSaved')) }, (error: unknown) => toast.error(error instanceof Error ? error.message : t('admin.saveFailed'))).finally(() => setSaving(null)) }} disabled={saving === row.id} /></Field></td><td className="p-2"><Button size="sm" variant="outline" onClick={() => onEdit(row)}>{t('admin.manage.edit')}</Button></td></tr>)}</tbody></table></div>
}

function SortableAssistantGrid({ rows, onSaved }: { rows: Assistant[]; onSaved: () => void }) {
  const t = useT()
  const [draft, setDraft] = useState<Assistant[] | null>(null)
  const [busy, setBusy] = useState(false)
  const ordered = draft ?? rows
  return <div className="space-y-3"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setDraft([...rows])} disabled={!!draft || rows.length === 0}>{t('admin.manage.editOrder')}</Button>{draft && <><Button size="sm" disabled={busy} onClick={() => { setBusy(true); void saveOrder(draft).then(() => { setDraft(null); onSaved(); toast.success(t('admin.manage.orderSaved')) }, (error: unknown) => { toast.error(error instanceof Error ? error.message : t('admin.manage.orderConflict')); setDraft(null); onSaved() }).finally(() => setBusy(false)) }}>{t('admin.save')}</Button><Button size="sm" variant="outline" onClick={() => setDraft(null)}>{t('common.cancel')}</Button></>}</div>
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
      <label className="flex items-center gap-1"><Switch aria-label={t('u10Admin.codeActive', { name: item.name })} checked={item.active} onCheckedChange={active => save(item.id, { active })} />{t('admin.codeActive')}</label>
      <Chip label={t('admin.codeUsage', { count: assistants.filter(row => (group === 'assistant_level1' ? row.level1CodeId : row.level2CodeId) === item.id).length })} />
      {item.isAuto && <Chip label={t('admin.codeAuto')} />}
    </div>)}
  </section>)}</div>
}

export function ManagePage() {
  const t = useT()
  const rows = useAssistants()
  const client = useQueryClient()
  const users = useUsers()
  const [tab, setTab] = useState<'assistants' | 'codes'>('assistants')
  const [editor, setEditor] = useState<Assistant | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const editorTrigger = useRef<HTMLElement | null>(null)
  function openEditor(value: Assistant | 'new') {
    editorTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setEditor(value)
  }
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  const filtered = sorted.filter((row) => `${row.name} ${row.level1} ${row.level2}`.toLowerCase().includes(search.toLowerCase()))
  const refresh = () => { void client.invalidateQueries({ queryKey: ['assistants'] }); void client.invalidateQueries({ queryKey: ['managed-codes'] }) }
  useEffect(() => { if (editor === 'new' && users.length === 0) void client.invalidateQueries({ queryKey: ['users'] }) }, [editor, users.length, client])
  return <><TopBar title={t('nav.assistants')} actions={<Button size="sm" onClick={() => openEditor('new')}>{t('admin.manage.newAssistant')}</Button>} /><div className="flex-1 space-y-4 overflow-auto p-4 lg:p-6"><div className="flex gap-2"><Button variant={tab === 'assistants' ? 'default' : 'outline'} onClick={() => setTab('assistants')}>{t('admin.manage.assistant')}</Button><Button variant={tab === 'codes' ? 'default' : 'outline'} onClick={() => setTab('codes')}>{t('admin.manage.codesTab')}</Button></div>{tab === 'codes' ? <CodesPanel /> : <><Field label={t('admin.manage.searchPlaceholder')} className="max-w-xs [&>label]:sr-only"><Input placeholder={t('admin.manage.searchPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} /></Field><AssistantTable rows={filtered} onEdit={openEditor} onSaved={refresh} />{!search && <SortableAssistantGrid rows={sorted} onSaved={refresh} />}</>}</div>{editor && <AssistantEditorSheet key={editor === 'new' ? 'new' : editor.id} assistant={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={refresh} onCloseAutoFocus={event => { event.preventDefault(); editorTrigger.current?.focus() }} />}</>
}
