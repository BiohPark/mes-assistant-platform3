import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TopBar } from '@/app/TopBar'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'

type Diagnostics = {
  app: { version: string; commit: string; builtAt: string; node: string; os: string }
  db: { version: string; charset: string; collation: string; migrations: number | null; error?: string }
  llm: { mode: string; preset: string; baseUrlHost: string; defaultModel: string; ok: boolean; detail: string; ms: number }
  storage: { path: string; writable: boolean; freeBytes: number | null }
  trustProxy: false | number | string[]
  settings: { authMode: string; apiPort: number; fileMaxBytes: number; fileMaxPerRequest: number; requestMaxActive: number }
  secrets: { databasePassword: boolean; sessionSecret: boolean; llmApiKey: boolean; oidcClientSecret: boolean; devUserPassword: boolean }
  recentErrors: { at: string; path: string; status: number; message: string }[]
}

function rows(data: Diagnostics): [string, string][] {
  const set = (value: boolean) => value ? '설정됨' : '없음'
  return [
    ['앱 버전', data.app.version], ['커밋', data.app.commit], ['빌드 시각', data.app.builtAt], ['Node', data.app.node], ['OS', data.app.os],
    ['DB 버전', data.db.version || data.db.error || '조회 실패'], ['DB 문자셋', data.db.charset], ['DB 정렬', data.db.collation],
    ['적용 마이그레이션', data.db.migrations === null ? '조회 실패' : String(data.db.migrations)],
    ['LLM 모드', data.llm.mode], ['LLM 프리셋', data.llm.preset], ['LLM 호스트', data.llm.baseUrlHost],
    ['기본 모델', data.llm.defaultModel], ['LLM 연결', `${data.llm.ok ? '성공' : '실패'} (${data.llm.ms} ms, ${data.llm.detail})`],
    ['파일 저장소', data.storage.path], ['파일 쓰기', data.storage.writable ? '가능' : '불가'],
    ['파일 여유 공간', data.storage.freeBytes === null ? '조회 실패' : `${data.storage.freeBytes} bytes`],
    ['TRUST_PROXY', Array.isArray(data.trustProxy) ? data.trustProxy.join(', ') : String(data.trustProxy)],
    ['인증 모드', data.settings.authMode], ['API 포트', String(data.settings.apiPort)],
    ['파일 크기 한도', String(data.settings.fileMaxBytes)], ['첨부 개수 한도', String(data.settings.fileMaxPerRequest)],
    ['동시 요청 한도', String(data.settings.requestMaxActive)],
    ['DB 비밀번호', set(data.secrets.databasePassword)], ['SESSION_SECRET', set(data.secrets.sessionSecret)],
    ['LLM_API_KEY', set(data.secrets.llmApiKey)], ['OIDC_CLIENT_SECRET', set(data.secrets.oidcClientSecret)],
    ['DEV_USER_PASSWORD', set(data.secrets.devUserPassword)],
  ]
}

export function formatDiagnostics(data: Diagnostics): string {
  return [...rows(data).map(([name, value]) => `${name}: ${value}`), '', '최근 서버 오류',
    ...data.recentErrors.map((error) => `${error.at} ${error.path} ${error.status} ${error.message}`)].join('\n')
}

export function DiagnosticsPage() {
  const query = useQuery<Diagnostics>({ queryKey: ['diagnostics'], queryFn: async () => {
    const response = await fetch('/api/admin/diagnostics', { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`진단 조회 실패 (${response.status})`)
    return response.json() as Promise<Diagnostics>
  } })
  return <><TopBar title="진단" /><div className="flex-1 overflow-auto p-4"><div className="mx-auto max-w-3xl space-y-4">
    <div className="flex gap-2"><Button variant="outline" onClick={() => void query.refetch()}>다시 확인</Button>
      <Button disabled={!query.data} onClick={() => { if (query.data) void copyText(formatDiagnostics(query.data)).then((ok) => toast[ok ? 'success' : 'error'](ok ? '진단 텍스트를 복사했습니다' : '복사하지 못했습니다')) }}>텍스트로 복사</Button></div>
    {query.isError && <p role="alert">진단 정보를 불러오지 못했습니다.</p>}
    {query.data && <><section className="rounded-xl border bg-card p-4"><h2 className="mb-3 font-semibold">환경과 연결 상태</h2>
      <dl className="grid grid-cols-[minmax(10rem,1fr)_2fr] gap-2 text-sm">{rows(query.data).map(([name, value]) => <div className="contents" key={name}><dt className="text-muted-foreground">{name}</dt><dd className="break-all">{value}</dd></div>)}</dl>
    </section><section className="rounded-xl border bg-card p-4"><h2 className="mb-3 font-semibold">최근 서버 오류</h2>
      {query.data.recentErrors.length ? <ul className="space-y-2 text-sm">{query.data.recentErrors.map((error, index) => <li key={`${error.at}-${index}`}>{error.at} · {error.path} · {error.status} · {error.message}</li>)}</ul> : <p className="text-sm text-muted-foreground">기록된 오류가 없습니다.</p>}
    </section></>}
  </div></div></>
}
