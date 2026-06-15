import { useMemo } from 'react'
import type { WidgetContext } from '@sdk'
import { useBoardStore } from '@renderer/canvas/useBoardStore'

/**
 * Builds the per-instance WidgetContext: namespaced persistent storage, the
 * current refresh token, and a config updater. This is the customization surface
 * a plugin uses for tokens, auth state, caches, etc.
 */
export function useWidgetContext(instanceId: string, refreshToken: number): WidgetContext {
  const updateConfig = useBoardStore((s) => s.updateConfig)

  return useMemo<WidgetContext>(() => {
    const ns = (key: string): string => `widget:${instanceId}:${key}`
    return {
      instanceId,
      refreshToken,
      storage: {
        get: (key) => window.myview.store.get(ns(key)),
        set: (key, value) => window.myview.store.set(ns(key), value)
      },
      updateConfig: (patch) => updateConfig(instanceId, patch)
    }
  }, [instanceId, refreshToken, updateConfig])
}
