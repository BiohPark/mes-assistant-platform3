import { afterEach, expect, it, vi } from 'vitest'

/** 모듈을 새로 읽어 '창을 새로 띄움·새로고침'을 흉내 낸다 — 팝업 모드는 첫 로드의 URL을 sessionStorage에 남겨 유지한다 */
async function load() { vi.resetModules(); return import('./popout') }

afterEach(() => { sessionStorage.clear(); window.history.replaceState({}, '', '/'); vi.restoreAllMocks() })

it('?popout=1 로 열린 창은 그 안에서 다른 화면으로 이동하거나 새로고침해도 팝업 모드다. 새 세션(다른 탭)은 아니다', async () => {
  expect((await load()).isPopout()).toBe(false)
  window.history.replaceState({}, '', '/c/t1?popout=1')
  expect((await load()).isPopout()).toBe(true)
  window.history.replaceState({}, '', '/') // 팝업 안에서 허브로 이동한 뒤 새로고침
  expect((await load()).isPopout()).toBe(true)
  sessionStorage.clear() // 다른 탭·창은 세션이 다르다
  expect((await load()).isPopout()).toBe(false)
})

it('openPopout은 /c/:id?popout=1 을 작은 창(popup)으로 열고, 막히면 false 를 돌려주며 같은 탭을 이동시키지 않는다', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const { openPopout } = await load()
  expect(openPopout('t 1')).toBe(false)
  expect(open).toHaveBeenCalledWith('/c/t%201?popout=1', 'mes-popout-t 1', expect.stringMatching(/\bpopup\b/))
  expect(window.location.pathname).toBe('/')
  open.mockReturnValue({} as Window)
  expect(openPopout('t2')).toBe(true)
  expect(open).toHaveBeenCalledTimes(2)
})
