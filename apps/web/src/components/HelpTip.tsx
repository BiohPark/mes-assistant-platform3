import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

/** 긴 설명을 화면 대신 툴팁에 둔다 — 아이콘은 설명 전체를 접근 가능한 이름으로 가진다. 자체 Provider라 어디서나 쓴다 */
export function HelpTip({ text }: { text: string }) {
  return <TooltipProvider><Tooltip>
    <TooltipTrigger asChild><button type="button" aria-label={text} className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Info className="size-3.5" /></button></TooltipTrigger>
    <TooltipContent>{text}</TooltipContent>
  </Tooltip></TooltipProvider>
}
