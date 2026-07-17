import { useEffect } from 'react'
import { loadExtensions } from '@renderer/ext/loader'
import { useBoardStore } from '@renderer/canvas/useBoardStore'
import { useUiStore } from '@renderer/app/useUiStore'
import { useDesktopClickThrough } from '@renderer/app/useDesktopClickThrough'
import { WidgetCanvas } from '@renderer/canvas/WidgetCanvas'
import { Toolbar } from '@renderer/app/Toolbar'
import { SettingsDialog } from '@renderer/app/SettingsDialog'
import { AddDialog } from '@renderer/app/AddDialog'
import { OpenFileConsent } from '@renderer/ext/OpenFileConsent'

export default function App(): JSX.Element {
  const hydrate = useBoardStore((s) => s.hydrate)
  const ready = useBoardStore((s) => s.ready)
  const dialog = useUiStore((s) => s.dialog)
  const hud = useUiStore((s) => s.hud)
  const setHud = useUiStore((s) => s.setHud)
  const openSettings = useUiStore((s) => s.openSettings)

  useDesktopClickThrough()

  useEffect(() => {
    // Register installed packs BEFORE hydrating so saved instances resolve from the registry on
    // first render.
    void loadExtensions().finally(() => void hydrate())
  }, [hydrate])

  // Spanning board: when displays change, pull any now-orphaned widget back on-screen.
  useEffect(
    () => window.garret.onDisplaysChanged((b) => useBoardStore.getState().clampToBounds(b.width, b.height)),
    []
  )

  // The desktop window spans the FULL display (so the HUD dim covers the menu bar
  // and Dock). Expose the work-area inset as a CSS var so floating chrome can sit
  // clear of the menu bar instead of being clipped under it. availTop reflects the
  // real menu-bar height (taller on notch displays), so this adapts per machine.
  useEffect(() => {
    const apply = (): void => {
      const s = window.screen as Screen & { availTop?: number; availLeft?: number }
      document.documentElement.style.setProperty('--safe-top', `${Math.max(s.availTop ?? 0, 0)}px`)
      document.documentElement.style.setProperty('--safe-left', `${Math.max(s.availLeft ?? 0, 0)}px`)
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])

  // Tray → Preferences opens the General settings pane.
  useEffect(() => window.garret.ui.onOpenSettings(() => openSettings('general')), [openSettings])

  // Reflect HUD state pushed from main; Esc dismisses while in HUD.
  useEffect(() => {
    const off = window.garret.hud.onState(setHud)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && useUiStore.getState().hud) window.garret.hud.set(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [setHud])

  return (
    <div className={`app${hud ? ' hud-active' : ''}`}>
      <div className="hud-backdrop" onClick={() => window.garret.hud.set(false)} />
      <Toolbar />
      <main className="canvas">
        {ready ? <WidgetCanvas /> : <div className="loading">Loading…</div>}
      </main>
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'add' && <AddDialog />}
      <OpenFileConsent />
    </div>
  )
}
