import { useEffect, useState } from 'react'
import type { SurfaceInit } from '@shared/ipc/channels'
import { WidgetSurface } from '@renderer/ext/WidgetSurface'

/**
 * Root of a floating surface window (`windowRole === 'surface'`). Fetches its render config from main
 * (keyed on this window's own wcId — unforgeable) and mounts a single full-window WidgetSurface,
 * reusing the exact same guest primitive as the board. See docs/floating-surface-windows.md §7.
 *
 * For a FRAMELESS surface it also draws a thin draggable titlebar here (the top-level document) —
 * `-webkit-app-region: drag` can't work inside the `<webview>` guest (composited as a separate layer),
 * so window move/close chrome must live in the host root, above the webview.
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
      {!init.frame && (
        <div className="surface-titlebar">
          <span className="surface-title">{init.title}</span>
          <button className="surface-close" title="Close" onClick={() => window.close()}>
            ✕
          </button>
        </div>
      )}
      <WidgetSurface
        extensionId={init.extId}
        instanceId={init.instanceId}
        uiUrl={init.uiUrl}
        preloadUrl={init.preloadUrl}
      />
    </div>
  )
}
