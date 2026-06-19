import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readdir, readFile } from 'node:fs/promises'
import { app, session as electronSession } from 'electron'
import { registerSandboxProtocol, sandboxWidgetsDir, SANDBOX_SCHEME } from './protocol'

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

export interface InstalledWidget {
  id: string
  manifest: Record<string, unknown>
}

/** Discover installed sandboxed widgets: <userData>/widgets/<id>/manifest.json. */
export async function listSandboxedWidgets(): Promise<InstalledWidget[]> {
  let dirs: string[]
  try {
    dirs = await readdir(sandboxWidgetsDir())
  } catch {
    return []
  }
  const out: InstalledWidget[] = []
  for (const id of dirs) {
    try {
      const raw = await readFile(join(sandboxWidgetsDir(), id, 'manifest.json'), 'utf8')
      out.push({ id, manifest: JSON.parse(raw) as Record<string, unknown> })
    } catch {
      // not a widget directory — skip
    }
  }
  return out
}
