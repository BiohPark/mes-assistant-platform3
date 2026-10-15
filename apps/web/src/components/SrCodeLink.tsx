import type { ReactNode } from 'react'
import { useInRouterContext } from 'react-router'
import { useOpenSr } from '@/app/useOpenSr'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** 본문 링크 표식 — remarkSrCodes가 만든 링크의 href. 외부 주소와 겹치지 않는 조각 식별자다. */
export const SR_CODE_HREF = '#sr:'
const SR_IN_TEXT = /\bSR-\d{4}-\d{4}\b/gi

interface MdNode { type: string; value?: string; url?: string; children?: MdNode[] }

/** 마크다운 텍스트 속 SR 번호를 SR 링크로 바꾼다(코드·기존 링크 안은 그대로). 새 의존성 없이 mdast를 직접 훑는다. */
export function remarkSrCodes() {
  return (tree: MdNode) => { walk(tree) }
}
function walk(node: MdNode) {
  if (!node.children || node.type === 'link' || node.type === 'linkReference') return
  node.children = node.children.flatMap((child) => {
    if (child.type !== 'text' || !child.value) { walk(child); return [child] }
    const parts: MdNode[] = []
    let last = 0
    for (const match of child.value.matchAll(SR_IN_TEXT)) {
      if (match.index > last) parts.push({ type: 'text', value: child.value.slice(last, match.index) })
      parts.push({ type: 'link', url: `${SR_CODE_HREF}${match[0].toUpperCase()}`, children: [{ type: 'text', value: match[0] }] })
      last = match.index + match[0].length
    }
    if (!parts.length) return [child]
    if (last < child.value.length) parts.push({ type: 'text', value: child.value.slice(last) })
    return parts
  })
}

/** SR 번호 원클릭. 라우터 밖(미리보기 등)에서는 글자로만 둔다. */
export function SrCodeLink({ code, children, className }: { code: string; children?: ReactNode; className?: string }) {
  return useInRouterContext() ? <SrCodeButton code={code} className={className}>{children}</SrCodeButton> : <span className={className}>{children ?? code}</span>
}

function SrCodeButton({ code, children, className }: { code: string; children?: ReactNode; className?: string }) {
  const t = useT()
  const open = useOpenSr()
  return <button type="button" title={t('components.openSr', { code })} className={cn('cursor-pointer font-mono underline underline-offset-2 hover:opacity-80', className)}
    onClick={(event) => { event.preventDefault(); event.stopPropagation(); void open(code) }}>{children ?? code}</button>
}
