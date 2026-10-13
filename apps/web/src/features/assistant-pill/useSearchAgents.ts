import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useT } from '@/i18n'
import { focusPageTarget, pageTarget } from './pageActions'

/** Keep this hook in the window/sheet host, which survives closing the menu. */
export function useSearchAgents() {
  const t = useT()
  const location = useLocation()
  const navigate = useNavigate()
  const [pendingFrom, setPendingFrom] = useState<string | null>(null)

  useEffect(() => {
    if (pendingFrom === null || location.key === pendingFrom) return
    if (location.pathname === '/' && new URLSearchParams(location.search).get('view') !== 'kanban') focusPageTarget('search', t)
    setPendingFrom(null)
  }, [location, pendingFrom, t])

  return () => {
    if (pageTarget('search', t)) { focusPageTarget('search', t); return }
    const params = new URLSearchParams(location.search)
    params.delete('view')
    setPendingFrom(location.key)
    void navigate({ pathname: location.pathname, search: params.toString() })
  }
}
