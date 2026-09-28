import { Boxes } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** 로그아웃 뒤 — 곧바로 SSO로 다시 보내지 않도록 로그인 게이트 밖에 둔다 */
export function LoggedOutPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/30 p-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Boxes className="size-5" />
      </span>
      <h1 className="text-lg font-semibold">로그아웃했습니다</h1>
      <Button onClick={() => window.location.assign('/api/auth/login')}>다시 로그인</Button>
    </div>
  )
}
