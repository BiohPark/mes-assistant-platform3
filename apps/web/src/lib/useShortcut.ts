import { useEffect, useEffectEvent } from 'react'

/** Only the explicitly registered modifier shortcut intercepts a browser key. */
export function useShortcut(key: string, action: () => void) {
  const invoke = useEffectEvent(action)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented || event.altKey || event.shiftKey ||
        !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== key.toLowerCase()) return
      event.preventDefault()
      invoke()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key])
}
