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

  useDesktopClickThrough()
  useNotificationWatches()

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  return (
    <div className="app">
      <Toolbar />
      <main className="canvas">
        {ready ? <WidgetCanvas /> : <div className="loading">Loading…</div>}
      </main>
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'add' && <AddDialog />}
    </div>
  )
}
