import { createElement } from 'react'
import type { AnyWidgetPlugin } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import { NativeWidget } from '@renderer/native/NativeWidget'

/**
 * Register installed native extensions as placeable plugins. Each renders a {@link NativeWidget}
 * (its UI webview + raw-Node host). Namespaced `native:<id>` so it can't collide with built-ins
 * or sandboxed widgets. (Phase 2 lists the hardcoded fixture; Phase 3 lists real installs.)
 */
export async function loadNativeExtensions(): Promise<void> {
  try {
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
  } catch (err) {
    console.warn('[native] failed to load native extensions', err)
  }
}
