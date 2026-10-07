import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TopBar } from '@/app/TopBar'
import { useAssistants } from '@/app/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMe } from '@/app/auth'
import { getSettings, listManagedUsers, saveSettings, setUserFlag, setUserName, temporaryPassword, type ManagedUser, type Settings } from '@/api/admin'

function SettingsForm({ initial }: { initial: Settings }) {
  const [form, setForm] = useState<Settings>(initial)
  const assistants = useAssistants()
  const client = useQueryClient()
  function change<K extends keyof Settings>(key: K, value: Settings[K]) { setForm((current) => ({ ...current, [key]: value })) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    try { await saveSettings(form); void client.invalidateQueries({ queryKey: ['settings'] }); toast.success('설정을 저장했습니다') }
    catch (error) { toast.error(error instanceof Error ? error.message : '저장 실패') }
  }
  return <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded border bg-card p-4 text-sm"><h2 className="font-semibold">전역 설정</h2>
    <label className="block">기본 모델<Input value={form.defaultModel ?? ''} onChange={(event) => change('defaultModel', event.target.value)} required /></label>
    <label className="block">입력 파일 전달 방식<select className="w-full rounded border bg-background p-2" value={form.fileDelivery ?? 'inline'} onChange={(event) => change('fileDelivery', event.target.value as Settings['fileDelivery'])}><option value="inline">텍스트로 붙이기</option><option value="openwebui">OpenWebUI 파일 첨부</option></select></label>
    <label className="block">요청 크기 한도 (바이트)<Input type="number" min={1024} max={100000000} value={form.requestBudgetBytes ?? 1000000} onChange={(event) => change('requestBudgetBytes', Number(event.target.value))} /></label>
    <label className="block">첨부 개수 한도<Input type="number" min={1} max={100} value={form.fileMaxPerRequest ?? 10} onChange={(event) => change('fileMaxPerRequest', Number(event.target.value))} /></label>
    <label className="block">SR 접수 에이전트<select className="w-full rounded border bg-background p-2" value={form.srIntakeAssistantId ?? ''} onChange={(event) => change('srIntakeAssistantId', event.target.value || null)}><option value="">선택 안 함</option>{assistants.filter((row) => row.status !== 'retired').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    <label className="block">링크1 기본 규칙 (주소에서 {'{modelId}'} 사용)<textarea className="w-full rounded border bg-background p-2" value={form.link1Rule ?? ''} onChange={(event) => change('link1Rule', event.target.value)} placeholder="https://openwebui.example/?model={modelId}" /></label>
    <Button type="submit">설정 저장</Button>
  </form>
}
function UserNameEditor({ user, onSaved }: { user: ManagedUser; onSaved: () => void }) {
  const [name, setName] = useState(user.name)
  return <form onSubmit={(event) => { event.preventDefault(); void setUserName(user.id, name.trim()).then(() => { onSaved(); toast.success('이름을 저장했습니다') }, (error: unknown) => toast.error(error instanceof Error ? error.message : '변경 실패')) }} className="flex gap-1">
    <Input aria-label={`${user.loginId ?? user.id} 이름`} value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={40} className="w-36" />
    <Button size="sm" variant="outline" type="submit">이름 저장</Button>
  </form>
}
function UsersSection() {
  const me = useMe()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['managed-users'], queryFn: listManagedUsers })
  const [issued, setIssued] = useState<{ id: string; password: string } | null>(null)
  const change = (id: string, field: 'system-owner' | 'business-owner' | 'active', enabled: boolean) => {
    void setUserFlag(id, field, enabled).then(() => void query.refetch(), (error: unknown) => toast.error(error instanceof Error ? error.message : '변경 실패'))
  }
  return <section className="space-y-3 rounded border bg-card p-4 text-sm"><h2 className="font-semibold">사용자·역할</h2>
    {query.data?.map((user) => <div key={user.id} className="flex flex-wrap items-center gap-3 border-b py-2"><span className="min-w-36">{user.name}<small className="block text-muted-foreground">{user.loginId ?? 'SSO'}</small></span>
      <UserNameEditor user={user} onSaved={() => { void query.refetch(); if (user.id === me.id) void client.invalidateQueries({ queryKey: ['me'] }) }} />
      <label className="flex items-center gap-1"><input type="checkbox" checked={user.isSystemOwner} onChange={(event) => change(user.id, 'system-owner', event.target.checked)} />SO</label>
      <label className="flex items-center gap-1"><input type="checkbox" checked={user.isBusinessOwner} onChange={(event) => change(user.id, 'business-owner', event.target.checked)} />BO</label>
      <label className="flex items-center gap-1"><input type="checkbox" checked={user.active} onChange={(event) => change(user.id, 'active', event.target.checked)} />활성</label>
      {user.loginId && <Button size="sm" variant="outline" onClick={() => { if (window.confirm(`${user.name}의 임시 비밀번호를 발급할까요?`)) void temporaryPassword(user.id).then((result) => setIssued({ id: user.id, password: result.temporaryPassword }), (error: unknown) => toast.error(error instanceof Error ? error.message : '발급 실패')) }}>임시 비밀번호</Button>}
      {user.mustChangePassword && <span className="text-muted-foreground">변경 대기</span>}
    </div>)}
    {issued && <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3">임시 비밀번호 (이번 화면에만 표시): <code className="select-all font-mono">{issued.password}</code><Button className="ml-2" size="sm" onClick={() => setIssued(null)}>닫기</Button></div>}
  </section>
}
export function SettingsPage() {
  const query = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  return <><TopBar title="설정" /><div className="flex-1 overflow-auto p-4"><div className="mx-auto max-w-3xl space-y-4"><Link className="text-sm text-primary underline" to="/admin/diagnostics">진단 화면 열기</Link>{query.data ? <SettingsForm key={JSON.stringify(query.data)} initial={query.data} /> : <p>설정을 불러오는 중…</p>}<UsersSection /></div></div></>
}
