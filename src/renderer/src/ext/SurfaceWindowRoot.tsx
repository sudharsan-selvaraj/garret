import { useEffect, useState } from 'react'
import type { SurfaceInit } from '@shared/ipc/channels'
import { WidgetSurface } from '@renderer/ext/WidgetSurface'

/**
 * Root of a floating surface window (`windowRole === 'surface'`). Fetches its render config from
 * main (keyed on this window's own wcId — unforgeable) and mounts a single full-window WidgetSurface,
 * reusing the exact same guest primitive as the board (self-bind, crash isolation, retry).
 * See docs/floating-surface-windows.md §7.
 */
export function SurfaceWindowRoot(): JSX.Element {
  const [init, setInit] = useState<SurfaceInit | null | undefined>(undefined)

  useEffect(() => {
    void window.garret.ext.surfaceInit().then(setInit)
  }, [])

  if (init === undefined) return <div className="surface-root surface-root--msg">Loading…</div>
  if (init === null) return <div className="surface-root surface-root--msg">Surface unavailable.</div>

  return (
    <div className="surface-root">
      <WidgetSurface
        extensionId={init.extId}
        instanceId={init.instanceId}
        uiUrl={init.uiUrl}
        preloadUrl={init.preloadUrl}
      />
    </div>
  )
}
