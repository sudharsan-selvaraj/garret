import { useCallback, useEffect, useRef } from 'react'
import { useUiStore } from '@renderer/app/useUiStore'
import { useBoardStore } from '@renderer/canvas/useBoardStore'

/** Selector for regions that should capture clicks; everything else passes through. */
const INTERACTIVE = '.toolbar, .rnd-item, .ctx-menu, .menu, .add-menu, .app-dialog'

/**
 * In desktop mode, makes empty canvas areas click-through (clicks fall to the
 * desktop/icons) while widgets and the toolbar stay interactive. In HUD mode the
 * whole layer is interactive (the dimmed backdrop captures clicks to dismiss).
 *
 * Driven by main-process cursor polling rather than forwarded DOM mouse events,
 * which a desktop-level (non-key) window delivers unreliably.
 *
 * The main process only sends a cursor update when the cursor actually moves (an
 * energy optimization), so we must ALSO re-evaluate from the last known position
 * whenever the UI changes under a stationary cursor — closing the HUD, switching
 * layouts, adding/removing widgets — or click-through would stay stuck wrong until
 * the next mouse move.
 */
export function useDesktopClickThrough(): void {
  const hud = useUiStore((s) => s.hud)
  // Re-evaluate when the placed-widget SET changes (layout switch, add/remove).
  const widgetSig = useBoardStore((s) => s.widgets.map((w) => w.id).join('|'))

  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const ignoring = useRef(false)

  const setIgnore = useCallback((next: boolean): void => {
    if (next === ignoring.current) return
    ignoring.current = next
    window.garret.window.setIgnoreMouseEvents(next)
  }, [])

  // Decide click-through from the LAST known cursor position. Cheap; safe to call
  // on every cursor move and on any state change that can alter what's under it.
  const evaluate = useCallback((): void => {
    if (useUiStore.getState().hud) {
      setIgnore(false) // HUD: capture everything (backdrop dismiss + widgets)
      return
    }
    const pos = lastPos.current
    if (!pos) return
    const { x, y } = pos
    const inside = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight
    if (!inside) {
      setIgnore(true)
      return
    }
    const el = document.elementFromPoint(x, y)
    setIgnore(!el?.closest(INTERACTIVE))
  }, [setIgnore])

  useEffect(() => {
    if (window.garret.windowMode !== 'desktop') return
    const off = window.garret.window.onCursorMove((pos) => {
      lastPos.current = pos
      evaluate()
    })
    setIgnore(true)
    return () => {
      off()
      window.garret.window.setIgnoreMouseEvents(false)
    }
  }, [evaluate, setIgnore])

  // Re-evaluate on HUD toggle (esp. close) and widget-set change, using the last
  // known cursor position — restores correct click-through without a mouse move.
  useEffect(() => {
    if (window.garret.windowMode === 'desktop') evaluate()
  }, [hud, widgetSig, evaluate])
}
