import { clipboard, Notification, shell } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { GarretError } from '@garretapp/sdk'
import { widgetDataDir, sharedDataDir } from '@main/ext/install'
import { getSecret, setSecret, deleteSecret } from '@main/ext/secrets'

/**
 * The capability broker — every platform call (`useGarret().*`) is checked HERE, in main, against
 * the extension's declared capabilities + tier. A compromised renderer can't skip a check it never
 * runs. Storage/secrets hit the same per-extension data dir the SDK host's `ctx.*` uses, so UI and
 * host share state. See docs/guide/03-architecture.md § 5.
 */
export interface Binding {
  packId: string
  widgetId: string
  /** `${packId}/${widgetId}` — storage dir + secret-key id. */
  fullId: string
  instanceId: string
  capabilities: string[]
  /** Pack declared a `shared` store → `g.shared.storage`/`g.shared.secrets` are available. */
  hasShared: boolean
}

// No tiers: every UI-side platform call is gated by the widget's declared capabilities (a functional
// allowlist). A widget's HOST, if any, is unrestricted raw Node — that's what the host warning is for.
function gate(binding: Binding, cap: string): void {
  if (!binding.capabilities.includes(cap)) {
    throw new GarretError('PERMISSION', `capability "${cap}" not granted`)
  }
}

// ── data-dir JSON store (mirrors the SDK host so UI + host share state; per WIDGET now) ────────────
function widgetDir(packId: string, widgetId: string): string {
  const dir = widgetDataDir(packId, widgetId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
function writeAtomic(file: string, obj: Record<string, unknown>): void {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(obj))
  renameSync(tmp, file)
}
function storeFile(b: Binding, instanceId?: string): string {
  return join(widgetDir(b.packId, b.widgetId), instanceId ? `instance.${instanceId}.json` : 'storage.json')
}
function sharedDir(b: Binding): string {
  if (!b.hasShared) throw new GarretError('PERMISSION', 'pack has no shared store (declare `shared` in the manifest)')
  const dir = sharedDataDir(b.packId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

// ── fetch allowlist ──────────────────────────────────────────────────────────────────────────────
function fetchAllowed(binding: Binding, url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false // web tier: TLS only (no http:// downgrade)
  const host = u.hostname.toLowerCase()
  // `network:<host>` is exact-hostname (any port). `network:*` allows any host. `network:*.<suffix>`
  // allows the suffix domain + any subdomain (e.g. `*.atlassian.net` → `acme.atlassian.net`) — needed
  // for services whose host is the user's own site.
  return binding.capabilities.some((c) => {
    if (!c.startsWith('network:')) return false
    const h = c.slice(8)
    if (h === '*' || h === host) return true
    if (h.startsWith('*.')) {
      const suffix = h.slice(2)
      return host === suffix || host.endsWith(`.${suffix}`)
    }
    return false
  })
}

/**
 * Dispatch a platform call. `domain`/`op` map to `useGarret().<domain>.<op>(...args)`. Throws a
 * GarretError on a denied capability or a bad op.
 */
export async function platformCall(
  binding: Binding,
  domain: string,
  op: string,
  args: unknown[]
): Promise<unknown> {
  const [a0, a1] = args
  switch (domain) {
    case 'storage':
    case 'instanceStorage': {
      // Not gated: a widget's own per-widget KV is isolated to its own data dir — it can't reach
      // anything external, so it isn't a privilege to allowlist. Ungating it also lets the settings
      // pane round-trip (widget reads the keys the pane writes) without every pack declaring `storage`.
      const instId = domain === 'instanceStorage' ? binding.instanceId : undefined
      const file = storeFile(binding, instId)
      if (op === 'get') return readJson(file)[a0 as string]
      if (op === 'keys') return Object.keys(readJson(file))
      if (op === 'set') {
        const all = readJson(file)
        all[a0 as string] = a1
        writeAtomic(file, all)
        return
      }
      if (op === 'delete') {
        const all = readJson(file)
        delete all[a0 as string]
        writeAtomic(file, all)
        return
      }
      if (op === 'clear') {
        writeAtomic(file, {})
        return
      }
      break
    }
    case 'secrets': {
      gate(binding, 'secrets')
      const dir = widgetDir(binding.packId, binding.widgetId)
      if (op === 'get') return getSecret(dir, binding.fullId, a0 as string)
      if (op === 'set') return setSecret(dir, binding.fullId, a0 as string, String(a1))
      if (op === 'delete') return deleteSecret(dir, a0 as string)
      break
    }
    // Pack-shared store: one namespace all widgets in the pack share (`ext-data/<packId>/_shared`),
    // available only when the pack declared `shared`. Lets a multi-widget pack hold one credential set.
    case 'sharedStorage': {
      const file = join(sharedDir(binding), 'storage.json')
      if (op === 'get') return readJson(file)[a0 as string]
      if (op === 'keys') return Object.keys(readJson(file))
      if (op === 'set') {
        const all = readJson(file)
        all[a0 as string] = a1
        writeAtomic(file, all)
        return
      }
      if (op === 'delete') {
        const all = readJson(file)
        delete all[a0 as string]
        writeAtomic(file, all)
        return
      }
      break
    }
    case 'sharedSecrets': {
      gate(binding, 'secrets')
      const dir = sharedDir(binding)
      const keyId = `${binding.packId}/_shared`
      if (op === 'get') return getSecret(dir, keyId, a0 as string)
      if (op === 'set') return setSecret(dir, keyId, a0 as string, String(a1))
      if (op === 'delete') return deleteSecret(dir, a0 as string)
      break
    }
    case 'fetch': {
      const url = String(a0)
      if (!fetchAllowed(binding, url)) throw new GarretError('NETWORK', `network to ${url} not allowed`)
      const res = await fetch(url, a1 as RequestInit | undefined)
      // Return raw bytes (Uint8Array survives structured clone) so binary/blob responses aren't
      // text-corrupted; the preload rebuilds a faithful Response from these. (set-cookie collapses
      // via fromEntries — acceptable; widgets shouldn't read cookies.)
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers),
        bodyBytes: new Uint8Array(await res.arrayBuffer())
      }
    }
    case 'notify': {
      gate(binding, 'notify')
      if (!Notification.isSupported()) return
      const n = new Notification({ title: String(a0), body: a1 ? String(a1) : undefined })
      // Optional deep-link: clicking the notification opens `opts.url` — but only if the widget
      // also holds `openExternal` (same gate as g.openExternal) and the target is http(s).
      const url = (args[2] as { url?: string } | undefined)?.url
      if (typeof url === 'string' && /^https?:\/\//i.test(url) && binding.capabilities.includes('openExternal')) {
        n.on('click', () => void shell.openExternal(url))
      }
      n.show()
      return
    }
    case 'clipboard': {
      gate(binding, 'clipboard')
      if (op === 'readText') return clipboard.readText()
      if (op === 'writeText') {
        clipboard.writeText(String(a0))
        return
      }
      break
    }
    case 'openExternal': {
      gate(binding, 'openExternal')
      const url = String(a0)
      if (!/^https?:\/\//i.test(url)) return false
      await shell.openExternal(url)
      return true
    }
  }
  throw new GarretError('BAD_ARGS', `unknown platform op: ${domain}.${op}`)
}
