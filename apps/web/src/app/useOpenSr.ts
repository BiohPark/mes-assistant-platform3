import { use, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { normalizeTag } from '@mes/domain'
import { findSrByCode } from '@/api/sr'
import { useT } from '@/i18n'
import { MeContext } from './auth'

/** 권한에 맞는 SR 상세 주소 — 요청자(BO)는 요청 화면, 그 밖(담당자·SO)은 처리 화면. */
export function srDetailPath(roles: readonly string[], srId: string): string {
  const requesterOnly = roles.includes('requester') && !roles.includes('system_owner')
  return `${requesterOnly ? '/sr' : '/sr/manage'}?id=${encodeURIComponent(srId)}`
}

/** SR 번호 원클릭(S14): 클릭 시점에 번호로 한 번 찾아(열람 범위는 서버) 상세로 간다. 없거나 볼 수 없으면 안내만 한다. */
export function useOpenSr() {
  const t = useT()
  const navigate = useNavigate()
  const roles = use(MeContext)?.roles
  return useCallback(async (raw: string) => {
    const code = normalizeTag(raw)
    try {
      const [found] = await findSrByCode(code)
      if (!found) { toast.error(t('components.srNotFound', { code })); return }
      void navigate(srDetailPath(roles ?? [], found.id))
    } catch { toast.error(t('components.srOpenFailed', { code })) }
  }, [navigate, roles, t])
}
