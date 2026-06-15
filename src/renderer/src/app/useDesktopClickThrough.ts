import { useEffect } from 'react'

/** Selector for regions that should capture clicks; everything else passes through. */
const INTERACTIVE = '.toolbar, .rnd-item, .ctx-menu, .menu, .add-menu, .app-dialog'

/**
 * In desktop mode, makes empty canvas areas click-through (clicks fall to the
 * desktop/icons) while widgets and the toolbar stay interactive.
 *
 * Driven by main-process cursor polling rather than forwarded DOM mouse events:
 * a desktop-level window is never the key window, so macOS delivers forwarded
 * move events unreliably and would leave the layer stuck click-through. The polled
 * cursor position is a global OS query that always works.
 */
export function useDesktopClickThrough(): void {
  useEffect(() => {
    if (window.myview.windowMode !== 'desktop') return

    let ignoring = false
    const setIgnore = (next: boolean): void => {
      if (next === ignoring) return
      ignoring = next
      window.myview.window.setIgnoreMouseEvents(next)
    }

    const off = window.myview.window.onCursorMove(({ x, y }) => {
      const inside = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight
      if (!inside) {
        setIgnore(true)
        return
      }
      const el = document.elementFromPoint(x, y)
      setIgnore(!el?.closest(INTERACTIVE))
    })

    setIgnore(true)
    return () => {
      off()
      window.myview.window.setIgnoreMouseEvents(false)
    }
  }, [])
}
