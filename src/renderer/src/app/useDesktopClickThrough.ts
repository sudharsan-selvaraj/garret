import { useEffect } from 'react'
import { useUiStore } from '@renderer/app/useUiStore'

/** Selector for regions that should capture clicks; everything else passes through. */
const INTERACTIVE = '.toolbar, .rnd-item, .ctx-menu, .menu, .add-menu, .app-dialog'

/**
 * In desktop mode, makes empty canvas areas click-through (clicks fall to the
 * desktop/icons) while widgets and the toolbar stay interactive. In HUD mode the
 * whole layer is interactive (the dimmed backdrop captures clicks to dismiss).
 *
 * Driven by main-process cursor polling rather than forwarded DOM mouse events,
 * which a desktop-level (non-key) window delivers unreliably.
 */
export function useDesktopClickThrough(): void {
  const hud = useUiStore((s) => s.hud)

  useEffect(() => {
    if (window.garret.windowMode !== 'desktop') return

    let ignoring = false
    const setIgnore = (next: boolean): void => {
      if (next === ignoring) return
      ignoring = next
      window.garret.window.setIgnoreMouseEvents(next)
    }

    const off = window.garret.window.onCursorMove(({ x, y }) => {
      if (useUiStore.getState().hud) {
        setIgnore(false) // HUD: capture everything (backdrop dismiss + widgets)
        return
      }
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
      window.garret.window.setIgnoreMouseEvents(false)
    }
  }, [])

  // Force interactivity the instant HUD opens (don't wait for a cursor move).
  useEffect(() => {
    if (window.garret.windowMode === 'desktop' && hud) {
      window.garret.window.setIgnoreMouseEvents(false)
    }
  }, [hud])
}
