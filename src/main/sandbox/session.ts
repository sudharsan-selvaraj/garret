import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readdir, readFile } from 'node:fs/promises'
import { app, session as electronSession } from 'electron'
import { registerSandboxProtocol, sandboxWidgetsDir, SANDBOX_SCHEME } from './protocol'
import { verifyIntegrity } from './install'
import type { InstalledWidget } from '@shared/types/sandbox'

/**
 * Absolute file URL to the bridge preload injected into widget webviews.
 * (Packaged builds must asarUnpack this — build-time-verify per the design.)
 */
export function bridgePreloadPath(): string {
  return pathToFileURL(join(app.getAppPath(), 'out', 'preload', 'sandboxBridge.js')).toString()
}

const prepared = new Set<string>()

/**
 * Configure a widget's partition session — idempotent, and MUST be called before the
 * webview navigates (the renderer awaits it). Installs the protocol handler + the
 * isolation guards: WebRTC off, all permission requests denied, and a network-layer
 * filter that cancels any request that isn't `garret-widget:` (defense-in-depth if the
 * CSP is ever bypassed). See docs/sandbox-design.md §3.
 */
export function prepareSandboxPartition(partition: string): void {
  if (prepared.has(partition)) return
  prepared.add(partition)
  const ses = electronSession.fromPartition(partition)
  registerSandboxProtocol(ses.protocol)
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  // (WebRTC IP-handling policy is a webContents setting — applied to the webview on
  // did-attach in the renderer, since it isn't a Session-level API.)
  ses.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: !details.url.startsWith(`${SANDBOX_SCHEME}:`) })
  })
}

/**
 * Discover installed sandboxed widgets. A directory counts as installed only if it has a
 * host-written `.garret-install.json` record; permissions + enabled come from THAT record,
 * never from the widget's own manifest.json (which is display-only). Returns disabled
 * widgets too (flagged), so the manager can list them; the loader filters on `enabled`.
 */
export async function listSandboxedWidgets(): Promise<InstalledWidget[]> {
  let dirs: string[]
  try {
    dirs = await readdir(sandboxWidgetsDir())
  } catch {
    return []
  }
  const out: InstalledWidget[] = []
  for (const id of dirs) {
    if (id.startsWith('.')) continue // skip temp/hidden dirs
    try {
      const base = join(sandboxWidgetsDir(), id)
      const manifest = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8'))
      const record = JSON.parse(await readFile(join(base, '.garret-install.json'), 'utf8'))
      const tampered = !(await verifyIntegrity(id, typeof record.sha256 === 'string' ? record.sha256 : ''))
      out.push({
        id,
        manifest: manifest as Record<string, unknown>,
        consentedPermissions: Array.isArray(record.consentedPermissions)
          ? record.consentedPermissions
          : [],
        enabled: record.enabled !== false,
        version: typeof record.version === 'string' ? record.version : '0.0.0',
        source: typeof record.source === 'string' ? record.source : '',
        attemptedBlocked: Array.isArray(record.attemptedBlocked) ? record.attemptedBlocked : [],
        tampered
      })
    } catch {
      // no valid install record — not a managed install; skip
    }
  }
  return out
}
