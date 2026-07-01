import { createElement } from 'react'
import type { AnyWidgetPlugin } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import { NativeWidget } from '@renderer/native/NativeWidget'

/**
 * Register enabled native extensions as placeable plugins. Each renders a {@link NativeWidget}
 * (its UI webview + raw-Node host). Namespaced `native:<id>` so it can't collide with built-ins,
 * sandboxed widgets, or dev-external widgets. The main-process list already returns only
 * enabled + authentic (MAC-verified) + untampered extensions (see native/install.ts).
 */
async function registerFromMain(): Promise<void> {
  const { preloadUrl, extensions } = await window.garret.nativeExt.list()
  for (const ext of extensions) {
    registry.register({
      apiVersion: 1,
      manifest: {
        id: `native:${ext.id}`,
        name: ext.name,
        defaultSize: ext.defaultSize ?? { w: 4, h: 4 },
        configSchema: {}
      },
      render: () =>
        createElement(NativeWidget, { extensionId: ext.id, uiUrl: ext.uiUrl, preloadUrl })
    } as AnyWidgetPlugin)
  }
}

export async function loadNativeExtensions(): Promise<void> {
  try {
    await registerFromMain()
  } catch (err) {
    console.warn('[native] failed to load native extensions', err)
  }
}

/**
 * Re-sync the registry's native extensions after an install/enable/disable/remove. Fetch the new
 * set BEFORE mutating the registry, then unregister + re-register with no await between (a placed
 * widget that re-renders mid-swap would otherwise see an empty registry and flip to the
 * "unavailable" placeholder — same fix as resyncSandboxedWidgets).
 */
export async function resyncNativeExtensions(): Promise<void> {
  let listed: Awaited<ReturnType<typeof window.garret.nativeExt.list>>
  try {
    listed = await window.garret.nativeExt.list()
  } catch (err) {
    console.warn('[native] resync failed to list extensions', err)
    return
  }
  for (const p of registry.list()) {
    if (p.manifest.id.startsWith('native:')) registry.unregister(p.manifest.id)
  }
  for (const ext of listed.extensions) {
    registry.register({
      apiVersion: 1,
      manifest: {
        id: `native:${ext.id}`,
        name: ext.name,
        defaultSize: ext.defaultSize ?? { w: 4, h: 4 },
        configSchema: {}
      },
      render: () =>
        createElement(NativeWidget, {
          extensionId: ext.id,
          uiUrl: ext.uiUrl,
          preloadUrl: listed.preloadUrl
        })
    } as AnyWidgetPlugin)
  }
}
