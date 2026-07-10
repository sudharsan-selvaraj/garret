import { createElement } from 'react'
import type { AnyWidgetPlugin, WidgetRenderProps } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import { WidgetSurface } from '@renderer/ext/WidgetSurface'
import { useBoardStore } from '@renderer/canvas/useBoardStore'

// A gx: widget can set its own frame title (g.setTitle) — apply it to that placement's board config
// so WidgetHost's header renders it. Bound once; the store call works outside React.
let titleSyncBound = false
function bindWidgetTitleSync(): void {
  if (titleSyncBound) return
  titleSyncBound = true
  window.garret.ext.onWidgetTitle((instanceId, title) =>
    useBoardStore.getState().updateConfig(instanceId, { title })
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
  bindWidgetTitleSync()
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
