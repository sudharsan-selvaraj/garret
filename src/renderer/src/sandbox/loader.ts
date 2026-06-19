import { createElement } from 'react'
import type { AnyWidgetPlugin, WidgetManifest, WidgetRenderProps } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import { SandboxWidget } from '@renderer/sandbox/SandboxWidget'

interface DiskManifest {
  name?: string
  description?: string
  apiVersion?: number
  permissions?: string[]
  defaultSize?: { w: number; h: number }
  minSize?: { w: number; h: number }
  configSchema?: WidgetManifest['configSchema']
}

/**
 * Turn an installed sandboxed widget (id + on-disk manifest) into a registry plugin whose
 * `render` mounts a {@link SandboxWidget}. The widget's code runs in the isolated webview,
 * not here — this host plugin only carries the manifest + wires the per-instance context.
 */
export function makeSandboxedPlugin(id: string, m: DiskManifest): AnyWidgetPlugin {
  const permissions = m.permissions ?? []
  const apiVersion = m.apiVersion ?? 1
  const manifest: WidgetManifest = {
    id: `sandbox:${id}`, // namespaced so it can't collide with built-ins
    name: m.name ?? id,
    description: m.description,
    defaultSize: m.defaultSize ?? { w: 4, h: 4 },
    minSize: m.minSize,
    configSchema: m.configSchema ?? {},
    permissions
  }
  return {
    apiVersion,
    manifest,
    render: ({ config, ctx }: WidgetRenderProps) =>
      createElement(SandboxWidget, {
        widgetId: id,
        instanceId: ctx.instanceId,
        config: config as Record<string, unknown>,
        refreshToken: ctx.refreshToken,
        permissions,
        apiVersion,
        onUpdateConfig: ctx.updateConfig
      })
  }
}

/** Discover installed sandboxed widgets and register them. Safe if none are installed. */
export async function loadSandboxedWidgets(): Promise<void> {
  try {
    const installed = await window.garret.sandbox.list()
    for (const { id, manifest } of installed) {
      registry.register(makeSandboxedPlugin(id, manifest as DiskManifest))
    }
  } catch (err) {
    console.warn('[sandbox] failed to load installed widgets', err)
  }
}
