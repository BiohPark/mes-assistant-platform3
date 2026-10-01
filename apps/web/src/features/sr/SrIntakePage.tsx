import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link, useSearchParams } from 'react-router'
import { createSr, deleteSr, getSr, listSr, uploadSrFile } from '@/api/sr'
import { getMessages } from '@/api/tasks'
import { useChat } from '@/features/chat/useChat'
import { TopBar } from '@/app/TopBar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SrList } from './SrList'
import { SrTitleEditor } from './SrTitleEditor'
import { SrConvertDialog } from './SrConvertDialog'
import { SharedResults } from './SharedResults'
import { useMe } from '@/app/auth'

export function SrIntakePage() {
  const me = useMe()
  const client = useQueryClient()
  const { data: rows = [] } = useQuery({ queryKey: ['sr'], queryFn: listSr })
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('id') ?? ''
  const setSelectedId = (id: string) => setParams(id ? { id } : {})
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [convert, setConvert] = useState(false)
  const selected = useQuery({ queryKey: ['sr', selectedId], queryFn: () => getSr(selectedId), enabled: !!selectedId }).data
  const { data: messages = [] } = useQuery({ queryKey: ['messages', selected?.threadId], queryFn: () => getMessages(selected!.threadId), enabled: !!selected?.threadId })
  const chat = useChat(selected?.threadId)
  const refresh = () => { void client.invalidateQueries({ queryKey: ['sr'] }); void client.invalidateQueries({ queryKey: ['messages', selected?.threadId] }) }
  async function create() { try { const sr = await createSr(); setSelectedId(sr.id); refresh() } catch (error) { toast.error(String(error)) } }
  async function send() {
    if (!selected || (!text.trim() && !files.length)) return
    setBusy(true)
    try {
      const ids: string[] = []
      for (const file of files) ids.push((await uploadSrFile(selected.id, file)).id)
      await chat.send(text.trim(), ids)
      setText(''); setFiles([]); refresh()
    } catch (error) { toast.error(String(error)) } finally { setBusy(false) }
  }
  return <><TopBar title="SR 접수" /><div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 md:grid-cols-[16rem_1fr]">
    <aside className="space-y-3"><Button onClick={create}>접수 대화 시작</Button><SrList rows={rows} selectedId={selectedId} onSelect={setSelectedId} /></aside>
    <div className="space-y-4">{selected ? <>
      <header className="space-y-2"><div className="flex items-center gap-2"><h1 className="text-lg font-semibold">{selected.code || '접수 전 대화'}</h1><span className="text-sm text-muted-foreground">{selected.status}</span></div>
        {selected.status !== 'draft' && (selected.requesterId === me.id || me.roles.includes('system_owner')) && <SrTitleEditor key={selected.id} sr={selected} onSaved={refresh} />}</header>
      <section className="max-h-80 space-y-2 overflow-y-auto rounded-lg border p-3" aria-label="접수 대화">
        {messages.map((message) => <div key={message.id} className="rounded-md bg-muted/40 p-2 text-sm"><b>{message.role === 'user' ? '요청자' : '접수 에이전트'}</b><p className="whitespace-pre-wrap">{message.content}</p>
          {message.attachmentIds.map((id) => <a key={id} className="block text-primary underline" href={`/api/files/${encodeURIComponent(id)}/content`}>첨부 {id}</a>)}</div>)}
        {chat.run && <div className="rounded-md bg-muted/40 p-2 text-sm"><b>접수 에이전트</b><p className="whitespace-pre-wrap">{chat.run.text}</p></div>}
      </section>
      {selected.status !== 'done' && selected.status !== 'rejected' && <div className="space-y-2"><Textarea aria-label="접수 메시지" value={text} onChange={(event) => setText(event.target.value)} placeholder="요청 내용을 입력하세요" />
        <input aria-label="SR 첨부" type="file" multiple onChange={(event) => setFiles([...event.target.files ?? []])} />
        <div className="flex gap-2"><Button onClick={send} disabled={busy || (!text.trim() && !files.length)}>대화 보내기</Button>
          {(selected.requesterId === me.id || me.roles.includes('system_owner')) && (selected.status === 'draft' || selected.status === 'submitted') && <><Button variant="outline" onClick={() => setConvert(true)}>{selected.status === 'draft' ? '접수로 전환' : '접수 내용 수정'}</Button>
          {selected.status === 'draft' && <Button variant="ghost" onClick={async () => { await deleteSr(selected.id); setSelectedId(''); refresh() }}>초안 삭제</Button>}</>}</div></div>}
      <SharedResults results={selected.results} />
      {selected.conversations.length > 0 && <p className="text-xs text-muted-foreground">연결 업무 진행 중 · 내부 대화는 요청자에게 공개되지 않습니다.</p>}
      <SrConvertDialog sr={selected} open={convert} onOpenChange={setConvert} onSaved={refresh} />
    </> : <div className="rounded-lg border p-6 text-sm text-muted-foreground">접수 대화를 선택하거나 새로 시작하세요. <Link to="/" className="underline">허브로 이동</Link></div>}</div>
  </div></>
}
