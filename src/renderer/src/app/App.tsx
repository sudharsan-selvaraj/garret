import { useEffect } from 'react'
import { registerBuiltins } from '@renderer/plugins/builtins'
import { registerServices } from '@renderer/services/serviceRegistry'
import { useBoardStore } from '@renderer/canvas/useBoardStore'
import { useUiStore } from '@renderer/app/useUiStore'
import { useDesktopClickThrough } from '@renderer/app/useDesktopClickThrough'
import { useNotificationWatches } from '@renderer/app/useNotificationWatches'
import { WidgetCanvas } from '@renderer/canvas/WidgetCanvas'
import { Toolbar } from '@renderer/app/Toolbar'
import { SettingsDialog } from '@renderer/app/SettingsDialog'
import { AddDialog } from '@renderer/app/AddDialog'

// Register built-in plugins + services once, at module load.
registerBuiltins()
registerServices()

export default function App(): JSX.Element {
  const hydrate = useBoardStore((s) => s.hydrate)
  const ready = useBoardStore((s) => s.ready)
  const dialog = useUiStore((s) => s.dialog)
  const hud = useUiStore((s) => s.hud)
  const setHud = useUiStore((s) => s.setHud)

  useDesktopClickThrough()
  useNotificationWatches()

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Reflect HUD state pushed from main; Esc dismisses while in HUD.
  useEffect(() => {
    const off = window.myview.hud.onState(setHud)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && useUiStore.getState().hud) window.myview.hud.set(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [setHud])

  return (
    <div className={`app${hud ? ' hud-active' : ''}`}>
      <div className="hud-backdrop" onClick={() => window.myview.hud.set(false)} />
      <Toolbar />
      <main className="canvas">
        {ready ? <WidgetCanvas /> : <div className="loading">Loading…</div>}
      </main>
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'add' && <AddDialog />}
    </div>
  )
}
