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
 * Turn an installed sandboxed widget into a registry plugin whose `render` mounts a
 * {@link SandboxWidget}. The widget's code runs in the isolated webview, not here.
 *
 * `consentedPermissions` (from the host-written install record) is the AUTHORITATIVE
 * permission set passed to the bridge — NOT `manifest.permissions` (the manifest is
 * user-writable + display-only). This is what makes the consent screen an honest ceiling.
 */
export function makeSandboxedPlugin(
  id: string,
  m: DiskManifest,
  consentedPermissions: string[]
): AnyWidgetPlugin {
  const apiVersion = m.apiVersion ?? 1
  const manifest: WidgetManifest = {
    id: `sandbox:${id}`, // namespaced so it can't collide with built-ins
    name: m.name ?? id,
    description: m.description,
    defaultSize: m.defaultSize ?? { w: 4, h: 4 },
    minSize: m.minSize,
    configSchema: m.configSchema ?? {},
    permissions: consentedPermissions
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
        permissions: consentedPermissions,
        apiVersion,
        onUpdateConfig: ctx.updateConfig
      })
  }
}

/** Discover installed sandboxed widgets and register the ENABLED ones. */
export async function loadSandboxedWidgets(): Promise<void> {
  try {
    const installed = await window.garret.sandbox.list()
    for (const { id, manifest, consentedPermissions, enabled, tampered } of installed) {
      if (!enabled || tampered) continue // disabled or integrity-failed → don't load
      registry.register(makeSandboxedPlugin(id, manifest as DiskManifest, consentedPermissions))
    }
  } catch (err) {
    console.warn('[sandbox] failed to load installed widgets', err)
  }
}

/** Re-sync the registry's sandboxed widgets after an install/remove/enable change. */
export async function resyncSandboxedWidgets(): Promise<void> {
  // Fetch the new set BEFORE touching the registry, then unregister + re-register in one
  // synchronous block. The old code awaited list() *between* the unregister and the
  // re-register, leaving a window where a placed widget that re-rendered saw an empty
  // registry and flipped to the "unavailable" placeholder. No await in the mutation now.
  let installed: Awaited<ReturnType<typeof window.garret.sandbox.list>>
  try {
    installed = await window.garret.sandbox.list()
  } catch (err) {
    console.warn('[sandbox] resync failed to list widgets', err)
    return
  }
  for (const p of registry.list()) {
    if (p.manifest.id.startsWith('sandbox:')) registry.unregister(p.manifest.id)
  }
  for (const { id, manifest, consentedPermissions, enabled, tampered } of installed) {
    if (!enabled || tampered) continue
    registry.register(makeSandboxedPlugin(id, manifest as DiskManifest, consentedPermissions))
  }
}
