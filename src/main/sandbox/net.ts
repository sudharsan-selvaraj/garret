import { isIP, type LookupFunction } from 'node:net'
import { lookup as dnsLookup } from 'node:dns'
import { Agent, fetch as undiciFetch } from 'undici'

/**
 * The network gate for sandboxed widget `fetch`. Two defenses, both in the MAIN process
 * (independent of the renderer BridgeHost):
 *  1. host allowlist — the URL host must match the widget's declared `network:` perms;
 *  2. SSRF / DNS-rebind — a custom undici connector resolves the host and refuses to
 *     connect to a private/loopback/link-local/ULA/IPv4-mapped/NAT64/CGNAT address, on
 *     every request AND every redirect hop, checking the *resolved IP at connect time*.
 * See docs/sandbox-design.md §6.
 */

const FETCH_TIMEOUT_MS = 10_000
const FETCH_MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5

function ipv4ToInt(ip: string): number {
  const p = ip.split('.').map(Number)
  return ((p[0] << 24) >>> 0) + ((p[1] << 16) | (p[2] << 8) | p[3])
}

function v4Blocked(ip: string): boolean {
  const n = ipv4ToInt(ip)
  const inRange = (base: string, maskBits: number): boolean => {
    const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0
    return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0
  }
  return (
    inRange('0.0.0.0', 8) ||
    inRange('10.0.0.0', 8) ||
    inRange('100.64.0.0', 10) || // CGNAT
    inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) || // link-local
    inRange('172.16.0.0', 12) ||
    inRange('192.168.0.0', 16) ||
    ip === '255.255.255.255'
  )
}

function v6Blocked(raw: string): boolean {
  const ip = raw.toLowerCase()
  if (ip === '::1' || ip === '::') return true
  // IPv4-mapped: ::ffff:a.b.c.d
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return v4Blocked(mapped[1])
  // NAT64: 64:ff9b::a.b.c.d (dotted) or hex tail — treat the whole prefix as blocked.
  if (ip.startsWith('64:ff9b:')) {
    const dotted = ip.match(/(\d+\.\d+\.\d+\.\d+)$/)
    return dotted ? v4Blocked(dotted[1]) : true
  }
  if (/^fe[89ab]/.test(ip)) return true // link-local fe80::/10
  if (/^f[cd]/.test(ip)) return true // ULA fc00::/7
  return false
}

/** True if an IP literal is in a blocked (private/local) range — unknown forms are blocked. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return v4Blocked(ip)
  if (kind === 6) return v6Blocked(ip)
  return true
}

/** A host is allowed if it equals, or is a subdomain of, a declared host. Never substring. */
export function hostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  return allowedHosts.some((raw) => {
    const s = raw.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
    return h === s || h.endsWith('.' + s)
  })
}

/**
 * A dns.lookup-shaped function for undici's connector: resolve ALL addresses, reject if
 * ANY is blocked, then pin the connection to a validated address (so the IP we checked is
 * the IP we connect to — closing the rebind TOCTOU window).
 */
const guardedLookup: LookupFunction = (hostname, options, cb) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, '', 0)
    const list = Array.isArray(addresses) ? addresses : []
    if (list.length === 0) return cb(new Error('garret: no address'), '', 0)
    for (const a of list) {
      if (isBlockedIp(a.address)) {
        return cb(new Error(`garret: blocked address ${a.address}`), '', 0)
      }
    }
    cb(null, list[0].address, list[0].family)
  })
}

export interface SandboxFetchResult {
  ok: boolean
  status: number
  data?: unknown
  error?: string
}

/**
 * Host-mediated fetch for a sandboxed widget, gated by `allowedHosts` + the resolved-IP
 * guard, with manual redirect following (each hop re-checked). Never throws.
 */
export async function sandboxFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } | undefined,
  allowedHosts: string[]
): Promise<SandboxFetchResult> {
  const agent = new Agent({ connect: { lookup: guardedLookup, timeout: FETCH_TIMEOUT_MS } })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let current = url
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let u: URL
      try {
        u = new URL(current)
      } catch {
        return { ok: false, status: 0, error: 'Invalid URL' }
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { ok: false, status: 0, error: 'Only http(s) URLs are allowed' }
      }
      if (isIP(u.hostname) && isBlockedIp(u.hostname)) {
        return { ok: false, status: 0, error: 'Blocked address' }
      }
      if (!hostAllowed(u.hostname, allowedHosts)) {
        return { ok: false, status: 0, error: `Host not permitted: ${u.hostname}` }
      }
      const res = await undiciFetch(current, {
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
        redirect: 'manual',
        dispatcher: agent,
        signal: controller.signal
      })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (loc) {
          current = new URL(loc, current).toString()
          continue // re-validate the new host + re-run the IP guard on the next connect
        }
      }
      // Read with a size cap.
      const reader = res.body?.getReader()
      const chunks: Buffer[] = []
      let received = 0
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          if (received > FETCH_MAX_BYTES) {
            controller.abort()
            return { ok: false, status: res.status, error: 'Response too large (>5MB)' }
          }
          chunks.push(Buffer.from(value))
        }
      }
      const text = Buffer.concat(chunks).toString('utf8')
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
      return { ok: res.ok, status: res.status, data }
    }
    return { ok: false, status: 0, error: 'Too many redirects' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, error: msg.includes('blocked') ? 'Blocked address' : msg }
  } finally {
    clearTimeout(timer)
    void agent.close()
  }
}
