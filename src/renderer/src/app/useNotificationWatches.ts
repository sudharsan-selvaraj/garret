import { useEffect } from 'react'
import type { WatchSpec } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import { useBoardStore } from '@renderer/canvas/useBoardStore'

/**
 * Keeps the main-process notification watches in sync with the saved board —
 * across ALL layouts, so background alerts fire even for widgets that aren't
 * currently mounted. Re-syncs whenever the board changes.
 */
export function useNotificationWatches(): void {
  const widgets = useBoardStore((s) => s.widgets)
  const activeLayout = useBoardStore((s) => s.activeLayout)
  const layoutNames = useBoardStore((s) => s.layoutNames)

  useEffect(() => {
    void window.garret.layouts.allWidgets().then((all) => {
      const watches: WatchSpec[] = []
      for (const w of all) {
        const plugin = registry.get(w.pluginId)
        const cfg = w.config as Record<string, unknown>
        const manifest = plugin?.manifest
        if (!manifest?.poll || !manifest.notifySpec || !manifest.serviceId) continue
        if (!cfg?.notify) continue // opt-in per widget
        const query = manifest.poll(cfg)
        if (!query) continue
        const title = typeof cfg.title === 'string' && cfg.title ? cfg.title : manifest.name
        watches.push({
          watchId: w.id,
          serviceId: manifest.serviceId,
          method: query.method,
          params: query.params,
          notify: manifest.notifySpec,
          label: `${manifest.name}: ${title}`
        })
      }
      window.garret.notify.syncWatches(watches)
    })
  }, [widgets, activeLayout, layoutNames])
}
