import { useEffect, useRef, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { ContextMenu } from 'radix-ui'
import { X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import { useTablistKeys } from '@/lib/useTablistKeys'
import { useT } from '@/i18n'
import { close, closeOthers, HOME_ID, move, updateTabs, useTabsStore, withTitle, type Tab, type TabsState } from './tabs'
import { useTabTitle } from './useTabTitle'

const DRAG_TYPE = 'application/x-mes-tab'
const MENU_ITEM = 'relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50'

const focusTab = (id: string) => requestAnimationFrame(() => document.getElementById(`tab-${id}`)?.focus())

/** 상단 탭 줄 — 칩 클릭·←/→/Home/End로 전환, ×·가운데 클릭·Delete로 닫기, 끌어서 순서 바꾸기, 우클릭(Shift+F10) 메뉴. 넘치면 가로 스크롤 */
export function TabStrip() {
  const t = useT()
  const navigate = useNavigate()
  const { tabs, activeId, seen } = useTabsStore(useShallow(({ tabs, activeId, seen }) => ({ tabs, activeId, seen })))
  const ids = tabs.map(tab => tab.id)

  // 이동은 전환(transition)으로 그려져 탭 저장소의 활성 탭은 렌더가 끝나야 바뀐다. 그 사이 누른 탭을 버리지 않도록
  // 마지막으로 요청한 탭과 비교하고, 활성 탭이 바뀌면(요청이 반영됐거나 다른 이동이 앞섰으면) 요청을 잊는다
  const requested = useRef<string | null>(null)
  useEffect(() => { requested.current = null }, [activeId])
  const select = (id: string) => {
    const state = useTabsStore.getState()
    const tab = state.tabs.find(item => item.id === id)
    if (!tab || id === (requested.current ?? state.activeId)) return
    requested.current = id
    void navigate(tab.href)
  }
  // 닫아서 활성 탭이 바뀌면 그 탭의 위치로 주소를 바꾼다(REPLACE — 뒤로가기가 닫은 탭을 되살리지 않게)
  const apply = (change: (state: TabsState) => TabsState, refocus: boolean) => {
    const before = useTabsStore.getState()
    const after = change(before)
    if (after === before) return
    updateTabs(() => after)
    if (after.activeId !== before.activeId) void navigate(after.tabs.find(tab => tab.id === after.activeId)!.href, { replace: true })
    if (refocus) focusTab(after.activeId)
  }
  const { tablistProps, tabProps } = useTablistKeys(ids, activeId, select)

  useEffect(() => { document.getElementById(`tab-${activeId}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }, [activeId])

  return <div className="flex h-9 shrink-0 items-end border-b bg-muted/40 px-1">
    <div role="tablist" aria-label={t('tabs.label')} {...tablistProps} className="flex h-full min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
      {tabs.map((tab, index) => <TabChip key={tab.id} tab={tab} index={index} active={tab.id === activeId} alive={seen.includes(tab.id)} count={tabs.length}
        tabProps={tabProps(tab.id)} onSelect={() => select(tab.id)}
        onClose={(refocus) => apply(state => close(state, tab.id), refocus)}
        onCloseOthers={() => apply(state => closeOthers(state, tab.id), false)} />)}
    </div>
  </div>
}

interface ChipProps {
  tab: Tab
  index: number
  active: boolean
  /** 화면이 살아 있는지(최근 본 MAX_ALIVE개) — 내려간 탭의 칩은 제목을 조회·구독하지 않고 저장된 제목을 쓴다 */
  alive: boolean
  /** 열린 탭 수 — 닫을 다른 탭이 없으면 '다른 탭 닫기'를 끈다 */
  count: number
  tabProps: ReturnType<ReturnType<typeof useTablistKeys>['tabProps']>
  onSelect: () => void
  onClose: (refocus: boolean) => void
  onCloseOthers: () => void
}

function TabChip({ tab, index, active, alive, count, tabProps, onSelect, onClose, onCloseOthers }: ChipProps) {
  const t = useT()
  const title = useTabTitle(tab.href, alive, tab.title)
  useEffect(() => { if (alive && title !== tab.title) updateTabs(state => withTitle(state, tab.id, title)) }, [alive, title, tab.id, tab.title])
  const home = tab.id === HOME_ID
  const drag = {
    draggable: !home,
    onDragStart: (event: DragEvent) => { event.dataTransfer.setData(DRAG_TYPE, tab.id); event.dataTransfer.effectAllowed = 'move' },
    onDragOver: (event: DragEvent) => { if (event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } },
    onDrop: (event: DragEvent) => { const id = event.dataTransfer.getData(DRAG_TYPE); if (id) { event.preventDefault(); updateTabs(state => move(state, id, index)) } },
  }
  const middle = {
    onMouseDown: (event: MouseEvent) => { if (event.button === 1) event.preventDefault() }, // 자동 스크롤 막기
    onAuxClick: (event: MouseEvent) => { if (event.button === 1 && !home) { event.preventDefault(); onClose(false) } },
  }
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Delete' && !home) { event.preventDefault(); onClose(true) } }

  return <ContextMenu.Root>
    <ContextMenu.Trigger asChild>
      <div data-tab-chip={tab.id} {...drag} {...middle} title={title}
        className={cn('group relative flex h-8 max-w-56 min-w-0 shrink-0 items-center rounded-t-lg border border-b-0 border-transparent text-sm',
          active ? 'border-border bg-background font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
        <button type="button" id={`tab-${tab.id}`} aria-controls={`tabpanel-${tab.id}`} {...tabProps} onClick={onSelect} onKeyDown={onKeyDown}
          className={cn('h-full min-w-0 truncate rounded-t-lg pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset', home ? 'pr-3' : 'pr-1')}>
          {title}
        </button>
        {/* 마우스용 — 키보드는 Delete·메뉴(Shift+F10), 보조기기는 메뉴로 닫는다 */}
        {!home && <span aria-hidden title={t('tabs.closeTitle', { title })} data-tab-close onClick={() => onClose(false)}
          className="mr-1 flex size-5 shrink-0 cursor-default items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-muted-foreground/15 hover:text-foreground hover:opacity-100">
          <X className="size-3.5" />
        </span>}
      </div>
    </ContextMenu.Trigger>
    <ContextMenu.Portal>
      <ContextMenu.Content className="z-50 min-w-36 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
        <ContextMenu.Item className={MENU_ITEM} disabled={home} onSelect={() => onClose(true)}>{t('tabs.close')}</ContextMenu.Item>
        <ContextMenu.Item className={MENU_ITEM} disabled={count <= (home ? 1 : 2)} onSelect={onCloseOthers}>{t('tabs.closeOthers')}</ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  </ContextMenu.Root>
}
