import type { SVGProps } from 'react'

/** Generic OW letter badge, sized like a lucide icon; the surrounding link supplies its accessible name. */
export function OpenWebUiIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <rect x={2} y={4} width={20} height={16} rx={3} />
    <text x={12} y={15.5} textAnchor="middle" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif" fontSize={9} fontWeight={700}>OW</text>
  </svg>
}
