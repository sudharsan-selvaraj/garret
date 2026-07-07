import { clipboard, Notification, shell } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { GarretError } from '@garretapp/sdk'
import { widgetDataDir } from '@main/ext/install'
import { extSecretKeyHex } from '@main/ext/keys'
import { getService } from '@main/services/registry'

/**
 * The capability broker — every platform call (`useGarret().*`) is checked HERE, in main, against
 * the extension's declared capabilities + tier. A compromised renderer can't skip a check it never
 * runs. Storage/secrets hit the same per-extension data dir the SDK host's `ctx.*` uses, so UI and
 * host share state. See docs/architecture.md § 5.
 */
export interface Binding {
  packId: string
  widgetId: string
  /** `${packId}/${widgetId}` — storage dir + secret-key id. */
  fullId: string
  instanceId: string
  tier: 'web' | 'full'
  capabilities: string[]
}

function gate(binding: Binding, cap: string): void {
  if (binding.tier === 'full') return // full-access consented to everything
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

interface SecretBox {
  v: 1
  iv: string
  tag: string
  ct: string
}
function secretKey(id: string): Buffer {
  const hex = extSecretKeyHex(id)
  if (!hex) throw new GarretError('UNAVAILABLE', 'secrets unavailable on this platform')
  return Buffer.from(hex, 'hex')
}

// ── fetch allowlist ──────────────────────────────────────────────────────────────────────────────
function fetchAllowed(binding: Binding, url: string): boolean {
  if (binding.tier === 'full') return true // full-access: unrestricted (consented)
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false // web tier: TLS only (no http:// downgrade)
  const host = u.hostname.toLowerCase()
  // `network:<host>` is exact-hostname (any port). `network:*` allows any host.
  return binding.capabilities.some((c) => {
    if (!c.startsWith('network:')) return false
    const h = c.slice(8)
    return h === '*' || h === host
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
      gate(binding, 'storage')
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
      const file = join(widgetDir(binding.packId, binding.widgetId), 'secrets.json')
      if (op === 'get') {
        const box = readJson(file)[a0 as string] as SecretBox | undefined
        if (!box) return undefined
        const d = createDecipheriv('aes-256-gcm', secretKey(binding.fullId), Buffer.from(box.iv, 'base64'))
        d.setAuthTag(Buffer.from(box.tag, 'base64'))
        try {
          return d.update(Buffer.from(box.ct, 'base64')).toString('utf8') + d.final('utf8')
        } catch {
          throw new GarretError('INTERNAL', 'secret failed to decrypt')
        }
      }
      if (op === 'set') {
        const iv = randomBytes(12)
        const c = createCipheriv('aes-256-gcm', secretKey(binding.fullId), iv)
        const ct = Buffer.concat([c.update(String(a1), 'utf8'), c.final()])
        const box: SecretBox = { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }
        const all = readJson(file)
        all[a0 as string] = box
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
    case 'service': {
      const id = String(a0)
      gate(binding, `service:${id}`)
      const svc = getService(id)
      if (op === 'status') return svc.status()
      if (op === 'query') return svc.query(a1 as string, (args[2] ?? {}) as Record<string, unknown>)
      break
    }
    case 'notify': {
      gate(binding, 'notify')
      if (Notification.isSupported()) new Notification({ title: String(a0), body: a1 ? String(a1) : undefined }).show()
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
