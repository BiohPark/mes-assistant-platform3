import { useT, type Translator } from '@/i18n'
import { useSearchParams } from 'react-router'
import { useMe } from '@/app/auth'
import { ModelSelect } from '@/components/ModelSelect'
import { AgentTestChat } from '@/components/AgentTestChat'
import { SuggestInput } from '@/components/SuggestInput'
import { AssistantStatusBadge, IoBadges } from '@/components/StatusBadges'
import { SortHeader } from '@/components/SortHeader'
import { SaveStatus } from '@/components/SaveStatus'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { newId } from '@/lib/ids'
import { useDates } from '@/lib/dates'
import { useSort } from '@/lib/useSort'
import { useAutoSave } from '@/lib/useAutoSave'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Assistant, Classification } from '@mes/contracts'
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

const STATUSES = ['open', 'developing', 'testing', 'retired'] as const
const empty = (ownerId: string, t: Translator): AssistantInput => ({ name: '', summary: '', ownerId,
  status: 'open', usageExample: '', modelId: '', link1: '', docUrl: '', expectedInputs: [], expectedOutputs: [],
  checklistTemplate: [[t('admin.manage.defaultChecklist.selectInputs'), true], [t('admin.manage.defaultChecklist.reviewResult'), true], [t('admin.manage.defaultChecklist.saveOutput'), false]].map(([label, required]) => ({ id: newId(), label: String(label), required: Boolean(required) })) })
const fromAssistant = (row: Assistant): AssistantInput => ({ name: row.name, summary: row.summary, ownerId: row.ownerId, status: row.status,
  usageExample: row.usageExample, modelId: row.modelId ?? '', link1: row.link1 ?? '', docUrl: row.docUrl ?? '',
  expectedInputs: row.expectedInputs, expectedOutputs: row.expectedOutputs, checklistTemplate: row.checklistTemplate })
type PathDraft = { key: string; level1: string; level2: string; original?: Classification }
const initialPaths = (assistant?: Assistant): PathDraft[] => assistant
  ? (assistant.classifications ?? [assistant]).map(path => ({ key: newId(), level1: path.level1, level2: path.level2, original: path }))
  : [{ key: newId(), level1: '', level2: '' }]
const noSuggestions = () => []
/** 바꾸지 않은 경로는 코드 ID로, 바꾼 경로는 이름으로 보낸다. 미완성이면 undefined, 중복이면 'duplicate' */
function toClassifications(paths: PathDraft[]): NonNullable<AssistantInput['classifications']> | undefined | 'duplicate' {
  if (!paths.length || paths.some(path => !path.level1 || !path.level2)) return undefined
  const classifications = paths.map(path => path.original && path.level1 === path.original.level1 && path.level2 === path.original.level2
    ? { level1CodeId: path.original.level1CodeId, level2CodeId: path.original.level2CodeId }
    : { level1: path.level1, level2: path.level2 })
  const pairs = classifications.map(path => 'level1CodeId' in path
    ? `id:${JSON.stringify([path.level1CodeId, path.level2CodeId])}`
    : `name:${JSON.stringify([path.level1.trim().normalize('NFC').toLowerCase(), path.level2.trim().normalize('NFC').toLowerCase()])}`)
  return new Set(pairs).size === paths.length ? classifications : 'duplicate'
}


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

type SaveKey = keyof AssistantInput | 'paths'
/** 기존 에이전트는 필드를 바꾸는 즉시(텍스트는 blur) 그 필드만 PATCH한다. 새 에이전트는 만들기 버튼으로 한 번에 보낸다 */
function AssistantEditorSheet({ assistant, onClose, onDeleted, onSaved, onCloseAutoFocus }: { assistant?: Assistant; onClose: () => void; onDeleted: () => void; onSaved: () => void; onCloseAutoFocus: (event: Event) => void }) {
  const t = useT()
  const users = useUsers()
  const assistants = useAssistants()
  const codes = useQuery({ queryKey: ['managed-codes'], queryFn: listManagedCodes }).data ?? []
  const [form, setForm] = useState<AssistantInput>(() => assistant ? fromAssistant(assistant) : empty(users[0]?.id ?? '', t))
  const saved = useRef(form)
  const [paths, setPaths] = useState(() => initialPaths(assistant))
  const [editorTab, setEditorTab] = useState('settings')
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deleteTrigger = useRef<HTMLButtonElement>(null)
  const ownerTouched = useRef(false)
  const [ownerInvalid, setOwnerInvalid] = useState(false)
  const { states, run, fail } = useAutoSave<SaveKey>()
  const peopleSource = useCallback(() => users.map(user => ({ value: user.id, label: user.name })), [users])
  const owner = users.find(user => user.id === form.ownerId)
  useEffect(() => { if (!assistant && !ownerTouched.current && !form.ownerId && users[0]) setForm((current) => ({ ...current, ownerId: users[0]!.id })) }, [assistant, form.ownerId, users])
  function change<K extends keyof AssistantInput>(field: K, value: AssistantInput[K]) { setForm((current) => ({ ...current, [field]: value })) }
  function commit<K extends keyof AssistantInput>(field: K, value: AssistantInput[K]) {
    change(field, value)
    if (!assistant || JSON.stringify(value) === JSON.stringify(saved.current[field])) return
    const previous = saved.current
    saved.current = { ...previous, [field]: value } // 보내는 중에도 같은 값은 다시 보내지 않는다(blur 직후 닫기 등)
    void run(field, async () => {
      try { await updateAssistant(assistant.id, { [field]: value }) }
      catch (error) { saved.current = { ...saved.current, [field]: previous[field] }; throw error }
      onSaved()
    })
  }
  /** 시트를 닫을 때(Escape 포함) blur를 거치지 못한 텍스트 입력을 확정한다 */
  function flushPending() {
    if (!assistant) return
    for (const field of ['name', 'docUrl', 'summary', 'usageExample', 'modelId'] as const) {
      if (form[field] === saved.current[field]) continue
      if (field === 'name') commitName(form.name); else commit(field, form[field])
    }
    if (JSON.stringify(form.checklistTemplate) !== JSON.stringify(saved.current.checklistTemplate)) commitChecklist(form.checklistTemplate)
  }
  function commitName(value: string) {
    if (assistant && !value.trim()) { change('name', value); fail('name', t('admin.nameRequired')); return }
    commit('name', value)
  }
  function commitChecklist(next: AssistantInput['checklistTemplate']) {
    if (assistant && next.some(item => !item.label.trim())) { change('checklistTemplate', next); fail('checklistTemplate', t('admin.manage.checklistLabelRequired')); return }
    commit('checklistTemplate', next)
  }
  function commitPaths(next: PathDraft[]) {
    setPaths(next)
    if (!assistant) return
    const classifications = toClassifications(next)
    if (classifications === undefined) { fail('paths', t('admin.codesRequired')); return }
    if (classifications === 'duplicate') { fail('paths', t('admin.manage.duplicatePaths')); return }
    void run('paths', async () => { await updateAssistant(assistant.id, { classifications }); onSaved() })
  }
  function moveChecklist(index: number, step: -1 | 1) {
    const next = [...form.checklistTemplate]
    const other = index + step
    if (other < 0 || other >= next.length) return
    ;[next[index], next[other]] = [next[other]!, next[index]!]
    commitChecklist(next)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (assistant) return
    if (!form.ownerId) { setOwnerInvalid(true); toast.error(t('admin.ownerRequired')); return }
    const classifications = toClassifications(paths)
    if (classifications === undefined) { toast.error(t('admin.codesRequired')); return }
    if (classifications === 'duplicate') { toast.error(t('admin.manage.duplicatePaths')); return }
    setBusy(true)
    try {
      await createAssistant({ ...form, classifications })
      onSaved(); onClose(); toast.success(t('admin.manage.assistantSaved'))
    } catch (error) { toast.error(error instanceof Error ? error.message : t('admin.saveFailed')) }
    finally { setBusy(false) }
  }
  return <Sheet open onOpenChange={open => { if (!open) { flushPending(); onClose() } }}>
    <SheetContent side="right" className="w-full sm:max-w-2xl" aria-label={t('admin.manage.editorLabel')} aria-labelledby={undefined} aria-modal="true" aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
      <SheetHeader><SheetTitle>{assistant ? t('admin.manage.editTitle') : t('admin.manage.newAssistant')}</SheetTitle></SheetHeader>
      <Tabs value={editorTab} onValueChange={setEditorTab}>
        <TabsList aria-label={t('admin.manage.editorLabel')}><TabsTrigger value="settings">{t('admin.manage.settingsTab')}</TabsTrigger><TabsTrigger value="test">{t('admin.manage.testTab')}</TabsTrigger></TabsList>
        <TabsContent value="settings" forceMount hidden={editorTab !== 'settings'}>
      <form onSubmit={(event) => void submit(event)} className="space-y-3 text-sm">
        <Field label={t('admin.name')} status={states.name}><Input value={form.name} onChange={(event) => change('name', event.target.value)} onBlur={(event) => commitName(event.target.value)} required /></Field>
        <fieldset className="space-y-2"><legend>{t('admin.manage.paths')}</legend>
          {paths.map((path, index) => <div key={path.key} role="group" aria-label={t('admin.manage.pathLabel', { number: index + 1 })} className="space-y-1 rounded-lg border p-2">
            <div className="flex items-center gap-1 text-xs"><span>{t('admin.manage.pathLabel', { number: index + 1 })}</span>{index === 0 && <Chip label={t('admin.manage.primaryPath')} />}
              <div className="ml-auto flex gap-1">{([-1, 1] as const).map(step => <Button key={step} type="button" size="icon-xs" variant="ghost" disabled={busy || (step === -1 ? index === 0 : index === paths.length - 1)} aria-label={t(step === -1 ? 'admin.manage.pathUp' : 'admin.manage.pathDown', { number: index + 1 })} onClick={() => { const next = [...paths]; [next[index], next[index + step]] = [next[index + step]!, next[index]!]; commitPaths(next) }}>{step === -1 ? '↑' : '↓'}</Button>)}
                <Button type="button" size="icon-xs" variant="ghost" disabled={busy || paths.length === 1} aria-label={t('admin.manage.removePath', { number: index + 1 })} onClick={() => commitPaths(paths.filter(item => item.key !== path.key))}>×</Button>
              </div>
            </div>
            <div className="flex items-center gap-2">{(['level1', 'level2'] as const).map((level, levelIndex) => <div key={level} className="flex min-w-0 flex-1 items-center gap-2">
              {levelIndex === 1 && <span aria-hidden>›</span>}<Field className="min-w-0 flex-1" label={t(level === 'level1' ? 'admin.level1' : 'admin.level2')}>
                <CodeInput group={`assistant_${level}`} codes={codes} assistants={assistants} level1={path.level1} disabled={busy} value={path[level]}
                  onChange={value => commitPaths(paths.map(item => item.key === path.key ? { ...item, [level]: value } : item))} aria-label={t(level === 'level1' ? 'admin.level1' : 'admin.level2')} />
              </Field>
            </div>)}</div>
          </div>)}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPaths(current => [...current, { key: newId(), level1: '', level2: '' }])}>+ {t('admin.manage.addPath')}</Button>
          <SaveStatus state={states.paths} />
        </fieldset>
        <Field label={t('admin.owner')} error={ownerInvalid ? t('admin.ownerRequired') : undefined} status={states.ownerId}><PersonPicker mode="single" source={peopleSource}
          value={owner ? { value: owner.id, label: owner.name } : null} aria-label={t('admin.owner')} aria-required aria-invalid={ownerInvalid}
          onChange={person => { ownerTouched.current = true; setOwnerInvalid(!person); if (person) commit('ownerId', person.value); else change('ownerId', '') }} /></Field>
        <Field label={t('admin.assistantStatus')} status={states.status}><ToggleGroup type="single" variant="outline" size="sm" value={form.status} aria-label={t('admin.assistantStatus')}
          onValueChange={value => { if (value) commit('status', value as AssistantInput['status']) }} className="flex-wrap">
          {STATUSES.map(value => <ToggleGroupItem key={value} value={value}><AssistantStatusBadge status={value} /></ToggleGroupItem>)}
        </ToggleGroup></Field>
        <Field label={t('admin.connectedModel')} status={states.modelId}><ModelSelect value={form.modelId ?? ''} onChange={value => change('modelId', value)} onBlur={() => commit('modelId', form.modelId ?? '')} disabled={busy} aria-label={t('admin.connectedModel')} /></Field>
        {!!form.link1 && <div className="flex items-center gap-2 text-xs"><span>{t('admin.manage.linkOverride')}</span><span aria-hidden>·</span><Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => commit('link1', '')}>{t('admin.manage.clearLink')}</Button></div>}
        <SaveStatus state={states.link1} />
        <Field label={t('admin.documentUrl')} status={states.docUrl}><Input value={form.docUrl ?? ''} onChange={(event) => change('docUrl', event.target.value)} onBlur={(event) => commit('docUrl', event.target.value)} /></Field>
        <Field label={t('admin.manage.summary')} status={states.summary}><textarea className="w-full rounded-lg border bg-background p-2" value={form.summary} onChange={(event) => change('summary', event.target.value)} onBlur={(event) => commit('summary', event.target.value)} /></Field>
        <Field label={t('admin.firstQuestionExamples')} status={states.usageExample}><textarea className="w-full rounded-lg border bg-background p-2" value={form.usageExample} onChange={(event) => change('usageExample', event.target.value)} onBlur={(event) => commit('usageExample', event.target.value)} /></Field>
        {(['expectedInputs', 'expectedOutputs'] as const).map(field => <Field key={field} label={t(field === 'expectedInputs' ? 'admin.manage.expectedInputs' : 'admin.manage.expectedOutputs')} status={states[field]}>
          <SuggestInput mode="multi" allowCreate source={noSuggestions} disabled={busy} value={form[field].map(value => ({ value, label: value }))}
            aria-label={t(field === 'expectedInputs' ? 'admin.manage.expectedInputs' : 'admin.manage.expectedOutputs')} onChange={values => commit(field, values.map(value => value.value))} />
        </Field>)}
        <fieldset className="space-y-2"><legend>{t('admin.manage.checklistDefaults')}</legend>{form.checklistTemplate.map((item, index) => <div key={item.id} className="flex gap-2"><Field label={t('admin.manage.checklistItem', { number: String(index + 1) })} className="min-w-0 flex-1 [&>label]:sr-only"><Input aria-label={t('admin.manage.checklistItem', { number: String(index + 1) })} value={item.label} onChange={(event) => change('checklistTemplate', form.checklistTemplate.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry))} onBlur={() => commitChecklist(form.checklistTemplate)} /></Field><Field label={t('admin.checklistRequired')} className="flex-row items-center gap-1 [&>label]:order-last"><Checkbox aria-label={t('admin.requiredItem', { name: item.label || String(index + 1) })} checked={item.required} onCheckedChange={(checked) => commitChecklist(form.checklistTemplate.map((entry, i) => i === index ? { ...entry, required: checked === true } : entry))} /></Field><Button type="button" variant="outline" disabled={index === 0} onClick={() => moveChecklist(index, -1)}>↑</Button><Button type="button" variant="outline" disabled={index === form.checklistTemplate.length - 1} onClick={() => moveChecklist(index, 1)}>↓</Button><Button type="button" variant="outline" onClick={() => commitChecklist(form.checklistTemplate.filter((_, i) => i !== index))}>{t('admin.manage.delete')}</Button></div>)}<Button type="button" variant="outline" onClick={() => change('checklistTemplate', [...form.checklistTemplate, { id: newId(), label: '', required: false }])}>{t('admin.manage.addItem')}</Button>
          <SaveStatus state={states.checklistTemplate} />
        </fieldset>
        {assistant && <ImageDropzone assistant={assistant} onSaved={onSaved} />}
        <div className="flex gap-2">{assistant
          ? <Button ref={deleteTrigger} type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>{t('admin.manage.delete')}</Button>
          : <Button type="submit" disabled={busy}>{t('admin.manage.create')}</Button>}</div>
      </form>
        </TabsContent>
        <TabsContent value="test" forceMount hidden={editorTab !== 'test'}><AgentTestChat modelId={form.modelId} /></TabsContent>
      </Tabs>
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t('admin.manage.deleteConfirm')}
        confirmLabel={t('admin.manage.delete')} onCloseAutoFocus={event => { event.preventDefault(); deleteTrigger.current?.focus() }}
        onConfirm={async () => {
          if (!assistant) return
          try { await deleteAssistant(assistant.id); onSaved(); onDeleted() }
          catch (error) { toast.error(error instanceof Error ? error.message : t('admin.manage.deleteFailed')) }
        }} />
    </SheetContent>
  </Sheet>
}

/** 기본 정렬: 폐기는 맨 아래, 그 안에서 표시 순서 */
const retiredLast = (a: Assistant, b: Assistant) => Number(a.status === 'retired') - Number(b.status === 'retired') || a.order - b.order
function AssistantTable({ rows, onEdit, canEdit }: { rows: Assistant[]; onEdit: (row: Assistant) => void; canEdit: boolean }) {
  const t = useT()
  const { formatDate } = useDates()
  const users = new Map(useUsers().map(user => [user.id, user.name]))
  const sorted = useSort(rows, {
    name: (row: Assistant) => row.name, category: (row: Assistant) => `${row.level1} › ${row.level2}`, status: (row: Assistant) => STATUSES.indexOf(row.status),
    owner: (row: Assistant) => users.get(row.ownerId), model: (row: Assistant) => row.modelId, updatedAt: (row: Assistant) => Date.parse(row.updatedAt),
  }, retiredLast)
  const header = (column: Parameters<typeof sorted.toggle>[0], label: string) => <SortHeader column={column} sort={sorted.sort} onToggle={sorted.toggle}>{label}</SortHeader>
  return <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/50"><tr>
    {header('name', t('admin.manage.assistant'))}{header('category', t('admin.manage.category'))}{header('status', t('admin.assistantStatus'))}{header('owner', t('admin.owner'))}{header('model', t('admin.connectedModel'))}<th className="p-2">{t('admin.manage.io')}</th>{header('updatedAt', t('admin.manage.updatedAt'))}{canEdit && <th className="p-2">{t('admin.manage.actions')}</th>}
  </tr></thead><tbody>{sorted.rows.map(row => <tr key={row.id} className="border-b last:border-0">
    <td className="p-2"><div className="flex items-center gap-2"><AssistantAvatar assistant={row} size="sm" /><span>{row.name}</span></div></td>
    <td className="p-2" title={(row.classifications ?? [row]).map(path => `${path.level1} › ${path.level2}`).join(', ')}>{row.level1} › {row.level2}{(row.classifications?.length ?? 1) > 1 && <Chip label={`+${row.classifications!.length - 1}`} />}</td>
    <td className="p-2"><AssistantStatusBadge status={row.status} /></td><td className="p-2">{users.get(row.ownerId)}</td><td className="p-2"><span className={row.modelId ? 'font-mono' : 'text-muted-foreground'}>{row.modelId || t('admin.manage.defaultModelText')}</span></td>
    <td className="p-2"><IoBadges inputs={row.expectedInputs} outputs={row.expectedOutputs} /></td>
    <td className="p-2"><time dateTime={row.updatedAt}>{formatDate(row.updatedAt)}</time></td>
    {canEdit && <td className="p-2"><Button size="sm" variant="outline" onClick={() => onEdit(row)}>{t('admin.manage.edit')}</Button></td>}
  </tr>)}</tbody></table></div>
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
      <Chip label={t('admin.codeUsage', { count: assistants.filter(row => (row.classifications ?? [row]).some(path => (group === 'assistant_level1' ? path.level1CodeId : path.level2CodeId) === item.id)).length })} />
      {item.isAuto && <Chip label={t('admin.codeAuto')} />}
    </div>)}
  </section>)}</div>
}

export function ManagePage() {
  const canEdit = useMe().roles.includes('system_owner')
  const [params, setParams] = useSearchParams()
  const t = useT()
  const rows = useAssistants()
  const client = useQueryClient()
  const users = useUsers()
  const [tab, setTab] = useState<'assistants' | 'codes'>('assistants')
  const [editor, setEditor] = useState<Assistant | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const editorTrigger = useRef<HTMLElement | null>(null)
  const newAssistantTrigger = useRef<HTMLButtonElement>(null)
  function openEditor(value: Assistant | 'new') {
    editorTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setEditor(value)
  }
  function closeEditor() {
    setEditor(null)
    const next = new URLSearchParams(params); next.delete('edit'); setParams(next, { replace: true })
  }
  const editId = params.get('edit')
  const handledEditId = useRef<string | null>(null)
  useEffect(() => {
    if (!editId) { handledEditId.current = null; return }
    if (!canEdit || editor || handledEditId.current === editId) return
    const row = rows.find(item => item.id === editId)
    if (row) { handledEditId.current = editId; setEditor(row) }
  }, [canEdit, editId, editor, rows])
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  const filtered = sorted.filter((row) => `${row.name} ${(row.classifications ?? [row]).map(path => `${path.level1} ${path.level2}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
  const refresh = () => { void client.invalidateQueries({ queryKey: ['assistants'] }); void client.invalidateQueries({ queryKey: ['managed-codes'] }) }
  useEffect(() => { if (editor === 'new' && users.length === 0) void client.invalidateQueries({ queryKey: ['users'] }) }, [editor, users.length, client])
  return <><TopBar title={t('nav.assistants')} actions={canEdit && <Button ref={newAssistantTrigger} data-tour="admin-new-assistant" size="sm" onClick={() => openEditor('new')}>{t('admin.manage.newAssistant')}</Button>} /><div className="flex-1 space-y-4 overflow-auto p-4 lg:p-6"><div className="flex gap-2"><Button variant={tab === 'assistants' ? 'default' : 'outline'} onClick={() => setTab('assistants')}>{t('admin.manage.assistant')}</Button><Button variant={tab === 'codes' ? 'default' : 'outline'} onClick={() => setTab('codes')}>{t('admin.manage.codesTab')}</Button></div>{tab === 'codes' ? <CodesPanel /> : <><Field label={t('admin.manage.searchPlaceholder')} className="max-w-xs [&>label]:sr-only"><Input placeholder={t('admin.manage.searchPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} /></Field><AssistantTable rows={filtered} onEdit={openEditor} canEdit={canEdit} />{canEdit && !search && <SortableAssistantGrid rows={sorted} onSaved={refresh} />}</>}</div>{canEdit && editor && <AssistantEditorSheet key={editor === 'new' ? 'new' : editor.id} assistant={editor === 'new' ? undefined : editor} onClose={closeEditor} onDeleted={() => { editorTrigger.current = null; closeEditor() }} onSaved={refresh} onCloseAutoFocus={event => { event.preventDefault(); (editorTrigger.current?.isConnected ? editorTrigger.current : newAssistantTrigger.current)?.focus() }} />}</>
}
