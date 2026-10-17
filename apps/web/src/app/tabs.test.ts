import { describe, expect, it } from 'vitest'
import { close, closeOthers, ensureUser, follow, HOME_ID, initialTabs, MAX_ALIVE, move, pathOf, retarget, visit, type TabsState } from './tabs'

const hrefs = (state: TabsState) => state.tabs.map(tab => tab.href)
const active = (state: TabsState) => state.tabs.find(tab => tab.id === state.activeId)?.href
const open = (state: TabsState, ...list: string[]) => list.reduce((current, href) => visit(current, href, true).state, state)

describe('pathOf', () => {
  it('쿼리·해시를 뗀 경로', () => {
    expect(pathOf('/sr/manage?id=1#x')).toBe('/sr/manage')
    expect(pathOf('/?view=kanban')).toBe('/')
  })
})

describe('visit', () => {
  it('새 경로는 새 탭을 끝에 열고 활성화한다', () => {
    const state = open(initialTabs('/'), '/c/a', '/my-work')
    expect(hrefs(state)).toEqual(['/', '/c/a', '/my-work'])
    expect(active(state)).toBe('/my-work')
  })

  it('같은 경로면 기존 탭을 활성화하고 위치를 맞춘다', () => {
    let state = open(initialTabs('/'), '/c/a', '/sr/manage?id=1', '/c/a')
    expect(hrefs(state)).toEqual(['/', '/c/a', '/sr/manage?id=1'])
    expect(active(state)).toBe('/c/a')
    state = visit(state, '/sr/manage?id=2', true).state
    expect(active(state)).toBe('/sr/manage?id=2')
    expect(state.tabs).toHaveLength(3)
  })

  it('메뉴처럼 경로만 가리키면(PUSH) 그 탭의 위치를 되살리라고 알린다', () => {
    const state = open(initialTabs('/'), '/sr/manage?id=1', '/c/a')
    const result = visit(state, '/sr/manage', true)
    expect(result.redirect).toBe('/sr/manage?id=1')
    expect(active(result.state)).toBe('/sr/manage?id=1')
    // 뒤로가기(POP)는 기록된 위치를 그대로 따른다
    expect(visit(state, '/sr/manage', false).redirect).toBeUndefined()
    expect(active(visit(state, '/sr/manage', false).state)).toBe('/sr/manage')
  })

  it('활성 탭의 같은 경로 이동은 그 탭의 위치만 바꾼다', () => {
    const state = visit(open(initialTabs('/'), '/sr/manage?id=1'), '/sr/manage', true)
    expect(state.redirect).toBeUndefined()
    expect(hrefs(state.state)).toEqual(['/', '/sr/manage'])
  })
})

describe('최근 본 탭(유지 렌더 상한)', () => {
  it(`${MAX_ALIVE}개를 넘으면 가장 오래 안 본 탭부터 뺀다 — 탭 칩은 남는다`, () => {
    let state = initialTabs('/')
    state = visit(state, '/', false).state
    for (let index = 0; index < MAX_ALIVE; index++) state = visit(state, `/c/${index}`, true).state
    expect(state.tabs).toHaveLength(MAX_ALIVE + 1)
    expect(state.seen).toHaveLength(MAX_ALIVE)
    expect(state.seen).not.toContain(HOME_ID)
    state = visit(state, '/', true).state // 다시 보면 맨 뒤로, 그다음 오래된 /c/0이 빠진다
    expect(state.seen.at(-1)).toBe(HOME_ID)
    expect(state.seen).not.toContain(state.tabs[1]!.id)
  })
})

describe('follow', () => {
  it('REPLACE는 활성 탭의 위치를 바꾼다(새 대화 → 저장된 대화, 옛 주소 → 새 주소)', () => {
    const state = follow(open(initialTabs('/'), '/c/a', '/new/agent'), '/c/b', 'REPLACE').state
    expect(hrefs(state)).toEqual(['/', '/c/a', '/c/b'])
    expect(active(state)).toBe('/c/b')
  })

  it('REPLACE 대상이 이미 다른 탭이면 활성 탭을 닫고 그 탭으로 간다', () => {
    const state = follow(open(initialTabs('/'), '/settings'), '/', 'REPLACE').state
    expect(hrefs(state)).toEqual(['/'])
    expect(state.activeId).toBe(HOME_ID)
  })

  it('홈 탭은 고정 — 홈에서 다른 경로로 REPLACE되면 새 탭으로 연다', () => {
    const state = follow(initialTabs('/sr'), '/', 'POP').state
    expect(hrefs(state)).toEqual(['/sr', '/'])
    const back = follow(state, '/sr', 'REPLACE').state
    expect(hrefs(back)).toEqual(['/sr'])
    expect(follow(initialTabs('/'), '/c/a', 'REPLACE').state.tabs).toHaveLength(2)
  })
})

describe('retarget(숨은 탭의 스스로 이동)', () => {
  it('비활성 탭의 위치만 바꾸고 활성 탭은 그대로 둔다', () => {
    const base = open(initialTabs('/'), '/c/a', '/c/b')
    const state = retarget(base, base.tabs[1]!.id, '/')
    expect(hrefs(state)).toEqual(['/', '/c/b'])
    expect(active(state)).toBe('/c/b')
  })
  it('숨은 탭을 기존 탭에 합칠 때 그 탭의 위치(필터)는 그대로 둔다', () => {
    const base = visit(open(initialTabs('/'), '/c/a'), '/?view=kanban&aq=abc', false).state
    const state = retarget(base, base.tabs[1]!.id, '/')
    expect(hrefs(state)).toEqual(['/?view=kanban&aq=abc'])
    expect(state.activeId).toBe(HOME_ID)
  })
  it('다른 경로로 바뀐 탭은 저장된 제목을 버린다(같은 경로면 남긴다)', () => {
    const base = open(initialTabs('/'), '/c/a')
    const titled = { ...base, tabs: base.tabs.map(tab => tab.id === base.activeId ? { ...tab, title: 'WK-a · 제목' } : tab) }
    expect(retarget(titled, titled.activeId, '/c/a?x=1').tabs[1]).toMatchObject({ href: '/c/a?x=1', title: 'WK-a · 제목' })
    expect(retarget(titled, titled.activeId, '/c/b').tabs[1]).toEqual({ id: titled.activeId, href: '/c/b' })
  })
  it('홈 탭은 다른 경로로 바뀌지 않는다', () => {
    expect(retarget(initialTabs('/'), HOME_ID, '/c/a')).toEqual(initialTabs('/'))
    expect(active(retarget(initialTabs('/'), HOME_ID, '/?view=kanban'))).toBe('/?view=kanban')
  })
})

describe('close', () => {
  it('활성 탭을 닫으면 오른쪽, 없으면 왼쪽 탭을 활성화한다', () => {
    const base = open(initialTabs('/'), '/c/a', '/c/b', '/c/c')
    const [, a, b, c] = base.tabs
    const middle = close({ ...base, activeId: b!.id }, b!.id)
    expect(hrefs(middle)).toEqual(['/', '/c/a', '/c/c'])
    expect(middle.activeId).toBe(c!.id)
    const last = close(base, c!.id)
    expect(last.activeId).toBe(b!.id)
    const other = close(base, a!.id)
    expect(other.activeId).toBe(c!.id)
    expect(other.seen).not.toContain(a!.id)
  })
  it('홈 탭은 닫히지 않는다', () => {
    const base = open(initialTabs('/'), '/c/a')
    expect(close(base, HOME_ID)).toBe(base)
  })
  it('다른 탭 닫기는 홈과 그 탭만 남긴다', () => {
    const base = open(initialTabs('/'), '/c/a', '/c/b', '/c/c')
    const state = closeOthers(base, base.tabs[2]!.id)
    expect(hrefs(state)).toEqual(['/', '/c/b'])
    expect(active(state)).toBe('/c/b')
    expect(hrefs(closeOthers(base, HOME_ID))).toEqual(['/'])
  })
})

describe('move', () => {
  it('드래그 순서를 바꾸되 홈은 맨 앞에 고정한다', () => {
    const base = open(initialTabs('/'), '/c/a', '/c/b', '/c/c')
    const id = base.tabs[3]!.id
    expect(hrefs(move(base, id, 1))).toEqual(['/', '/c/c', '/c/a', '/c/b'])
    expect(hrefs(move(base, id, 0))).toEqual(['/', '/c/c', '/c/a', '/c/b'])
    expect(hrefs(move(base, HOME_ID, 2))).toEqual(hrefs(base))
  })
})

describe('ensureUser', () => {
  it('다른 사용자·다른 홈이면 새로 시작하고, 같으면 그대로 둔다', () => {
    const mine = { ...open(initialTabs('/'), '/c/a'), userId: 'u1' }
    expect(ensureUser(mine, 'u1', '/')).toBe(mine)
    expect(hrefs(ensureUser(mine, 'u2', '/'))).toEqual(['/'])
    expect(hrefs(ensureUser(mine, 'u1', '/sr'))).toEqual(['/sr'])
  })
})
