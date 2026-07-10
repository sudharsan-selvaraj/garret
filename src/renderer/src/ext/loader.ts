import { createElement } from 'react'
import type { AnyWidgetPlugin, WidgetRenderProps } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import { WidgetSurface } from '@renderer/ext/WidgetSurface'
import { useBoardStore } from '@renderer/canvas/useBoardStore'
import { useWidgetMenus } from '@renderer/ext/widgetMenus'

// A gx: widget can drive its own frame chrome: a custom title (g.setTitle → board config) and ⋯-menu
// commands (g.setCommands). Both are relayed from main; bind once (store calls work outside React).
let hostSyncBound = false
function bindHostSync(): void {
  if (hostSyncBound) return
  hostSyncBound = true
  window.garret.ext.onWidgetTitle((instanceId, title) =>
    useBoardStore.getState().updateConfig(instanceId, { title })
  )
  window.garret.ext.onWidgetCommands((instanceId, commands) =>
    useWidgetMenus.getState().set(instanceId, commands)
  )
}

/**
 * Register enabled extensions (both tiers) as placeable plugins — one loader for the unified path.
 * `ext:<id>` namespacing can't collide with built-ins. main's ext:list returns only enabled +
 * authentic + untampered extensions.
 */
async function register(): Promise<void> {
  const { preloadUrl, extensions } = await window.garret.ext.list()
  for (const e of extensions) {
    registry.register({
      apiVersion: 1,
      manifest: {
        id: `gx:${e.id}`,
        name: e.name,
        defaultSize: e.defaultSize ?? { w: 4, h: 4 },
        configSchema: {}
      },
      render: ({ ctx }: WidgetRenderProps) =>
        createElement(WidgetSurface, {
          extensionId: e.id,
          instanceId: ctx.instanceId,
          uiUrl: e.uiUrl,
          preloadUrl,
          embed: e.capabilities.includes('embed')
        })
    } as AnyWidgetPlugin)
  }
}

export async function loadExtensions(): Promise<void> {
  bindHostSync()
  try {
    await register()
  } catch (err) {
    console.warn('[ext] failed to load extensions', err)
  }
}

/** Re-sync after install/enable/disable/remove. Fetch, then swap with no await between (a placed
 *  widget re-rendering mid-swap would otherwise flash the "unavailable" placeholder). */
export async function resyncExtensions(): Promise<void> {
  let listed: Awaited<ReturnType<typeof window.garret.ext.list>>
  try {
    listed = await window.garret.ext.list()
  } catch (err) {
    console.warn('[ext] resync failed', err)
    return
  }
  for (const p of registry.list()) {
    if (p.manifest.id.startsWith('gx:')) registry.unregister(p.manifest.id)
  }
  for (const e of listed.extensions) {
    registry.register({
      apiVersion: 1,
      manifest: { id: `gx:${e.id}`, name: e.name, defaultSize: e.defaultSize ?? { w: 4, h: 4 }, configSchema: {} },
      render: ({ ctx }: WidgetRenderProps) =>
        createElement(WidgetSurface, {
          extensionId: e.id,
          instanceId: ctx.instanceId,
          uiUrl: e.uiUrl,
          preloadUrl: listed.preloadUrl,
          embed: e.capabilities.includes('embed')
        })
    } as AnyWidgetPlugin)
  }
}
