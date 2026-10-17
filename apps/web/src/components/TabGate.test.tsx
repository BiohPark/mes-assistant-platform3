import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { TabActiveContext } from '@/app/tabActive'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

function Opened() {
  return <>
    <Dialog open><DialogContent><DialogTitle>대화상자</DialogTitle><DialogDescription>설명</DialogDescription></DialogContent></Dialog>
    <Sheet open><SheetContent><SheetTitle>시트</SheetTitle><SheetDescription>설명</SheetDescription></SheetContent></Sheet>
    <DropdownMenu open><DropdownMenuTrigger>메뉴 열기</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>항목</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    <Popover open><PopoverTrigger>팝오버 열기</PopoverTrigger><PopoverContent>팝오버 내용</PopoverContent></Popover>
  </>
}

it('S15: 숨은 탭의 열린 창·시트·메뉴·팝오버는 포털로 그리지 않는다(보고 있는 탭을 가리거나 막지 않게)', () => {
  const { rerender } = render(<TabActiveContext value={false}><Opened /></TabActiveContext>)
  for (const text of ['대화상자', '시트', '항목', '팝오버 내용']) expect(screen.queryByText(text)).not.toBeInTheDocument()
  expect(document.body.style.pointerEvents).not.toBe('none')
  rerender(<TabActiveContext value={true}><Opened /></TabActiveContext>)
  for (const text of ['대화상자', '시트', '항목', '팝오버 내용']) expect(screen.getByText(text)).toBeInTheDocument()
})

it('S15: 보이던 탭이 숨으면 열려 있던 창·메뉴를 내리고 화면 잠금(pointer-events)을 푼다, 다시 보이면 되살린다', () => {
  const { rerender } = render(<TabActiveContext value={true}><Opened /></TabActiveContext>)
  for (const text of ['대화상자', '시트', '항목', '팝오버 내용']) expect(screen.getByText(text)).toBeInTheDocument()
  rerender(<TabActiveContext value={false}><Opened /></TabActiveContext>)
  for (const text of ['대화상자', '시트', '항목', '팝오버 내용']) expect(screen.queryByText(text)).not.toBeInTheDocument()
  expect(document.body.style.pointerEvents).not.toBe('none')
  rerender(<TabActiveContext value={true}><Opened /></TabActiveContext>)
  for (const text of ['대화상자', '시트', '항목', '팝오버 내용']) expect(screen.getByText(text)).toBeInTheDocument()
})
