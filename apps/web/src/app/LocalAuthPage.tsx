import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { CredentialsSchema, MeSchema } from '@mes/contracts'
import { Button } from '@/components/ui/button'
import { fetchAuthMode } from './auth'

interface Props {
  kind: 'login' | 'signup'
  onSuccess?: (url: string) => void
}

export function LocalAuthPage({ kind, onSuccess }: Props) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const { data: mode } = useQuery({ queryKey: ['auth-mode'], queryFn: fetchAuthMode, staleTime: Infinity })
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const signup = kind === 'signup'

  useEffect(() => {
    if (mode === 'oidc') window.location.assign('/api/auth/login')
  }, [mode])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (signup && password !== confirm) { setError('비밀번호가 일치하지 않습니다'); return }
    const parsed = CredentialsSchema.safeParse({ loginId, password })
    if (!parsed.success) { setError('ID는 소문자·숫자·._- 3~32자, 비밀번호는 8~128자로 입력하세요'); return }
    setPending(true)
    try {
      const res = await fetch(`/api/auth/${kind}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.data) })
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null)
        const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : `요청에 실패했습니다 (HTTP ${res.status})`
        throw new Error(message)
      }
      client.setQueryData(['me'], MeSchema.parse(await res.json()))
      if (onSuccess) onSuccess('/')
      else void navigate('/', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '요청에 실패했습니다')
    } finally { setPending(false) }
  }

  if (mode === 'oidc') return null
  return (
    <div className="flex h-full items-center justify-center bg-muted/30 p-6">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-sm space-y-4 rounded-lg border bg-background p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{signup ? '회원가입' : '로그인'}</h1>
        <label className="block space-y-1 text-sm">ID<input className="w-full rounded-md border bg-background px-3 py-2" value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" required /></label>
        <label className="block space-y-1 text-sm">비밀번호<input className="w-full rounded-md border bg-background px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} required /></label>
        {signup && <label className="block space-y-1 text-sm">비밀번호 확인<input className="w-full rounded-md border bg-background px-3 py-2" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required /></label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending || mode === undefined} className="w-full">{signup ? '회원가입' : '로그인'}</Button>
        <p className="text-center text-sm text-muted-foreground">{signup ? '이미 계정이 있나요?' : '계정이 없나요?'} <Link className="text-primary underline" to={signup ? '/login' : '/signup'}>{signup ? '로그인' : '회원가입'}</Link></p>
      </form>
    </div>
  )
}
