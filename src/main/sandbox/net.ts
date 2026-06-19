import { isIP, type LookupFunction } from 'node:net'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
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

/**
 * Parse any textual IPv6 (compressed `::`, fully-expanded, or with a trailing dotted-IPv4
 * suffix) into its 8 numeric hextets. Returns null if it isn't well-formed IPv6 — callers
 * treat null as "blocked" (fail safe). String-matching textual forms is fragile (a resolver
 * or URL can present the expanded form); operating on the numeric value closes that gap.
 */
function parseV6(raw: string): number[] | null {
  let s = raw.toLowerCase().split('%')[0] // drop any zone id
  if (!s) return null
  // Expand a trailing dotted-IPv4 (e.g. ::ffff:127.0.0.1) into two hextets.
  const v4 = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (v4) {
    const oct = v4[2].split('.').map(Number)
    if (oct.some((o) => o > 255)) return null
    s = `${v4[1]}${(((oct[0] << 8) | oct[1]) >>> 0).toString(16)}:${(((oct[2] << 8) | oct[3]) >>> 0).toString(16)}`
  }
  const groups = (part: string): number[] | null => {
    if (part === '') return []
    const xs = part.split(':')
    const g: number[] = []
    for (const x of xs) {
      if (!/^[0-9a-f]{1,4}$/.test(x)) return null
      g.push(parseInt(x, 16))
    }
    return g
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  if (halves.length === 2) {
    const head = groups(halves[0])
    const tail = groups(halves[1])
    if (!head || !tail) return null
    const fill = 8 - head.length - tail.length
    if (fill < 1) return null // `::` must elide at least one group
    return [...head, ...new Array(fill).fill(0), ...tail]
  }
  const all = groups(s)
  return all && all.length === 8 ? all : null
}

function v6Blocked(raw: string): boolean {
  const g = parseV6(raw)
  if (!g) return true // unparseable → fail safe
  if (g.every((x) => x === 0)) return true // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true // ::1 loopback
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4 regardless of textual form.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return v4Blocked(`${(g[6] >> 8) & 0xff}.${g[6] & 0xff}.${(g[7] >> 8) & 0xff}.${g[7] & 0xff}`)
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return true // NAT64 64:ff9b::/96
  if ((g[0] & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((g[0] & 0xfe00) === 0xfc00) return true // ULA fc00::/7
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
// undici's connector calls the lookup with `all: true` and expects the callback to
// return an ARRAY of {address, family} (the all-style). We always resolve all addresses
// (to reject if ANY is private), then return the array when asked, else single-style.
function guardedLookup(
  hostname: string,
  options: { all?: boolean } & Record<string, unknown>,
  cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, [])
    const list = (Array.isArray(addresses) ? addresses : []) as LookupAddress[]
    if (list.length === 0) return cb(new Error('garret: no address'), [])
    for (const a of list) {
      if (isBlockedIp(a.address)) return cb(new Error(`garret: blocked address ${a.address}`), [])
    }
    if (options.all) cb(null, list)
    else cb(null, list[0].address, list[0].family)
  })
}

export interface SandboxFetchResult {
  ok: boolean
  status: number
  data?: unknown
  error?: string
}

/** Read a response body with the size cap and parse JSON (falling back to text). Shared
 *  by the sandbox + dev fetch paths so the capped-read logic lives in one place. */
async function readCappedBody(
  res: Awaited<ReturnType<typeof undiciFetch>>,
  controller: AbortController
): Promise<SandboxFetchResult> {
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

/**
 * Unrestricted host fetch for the trusted-local DEV tier (no host allowlist) — http(s),
 * 10s, 5MB. Sandboxed widgets do NOT use this; they go through {@link sandboxFetch}.
 */
export async function devFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } | undefined
): Promise<SandboxFetchResult> {
  let scheme: string
  try {
    scheme = new URL(url).protocol
  } catch {
    return { ok: false, status: 0, error: 'Invalid URL' }
  }
  if (scheme !== 'http:' && scheme !== 'https:') {
    return { ok: false, status: 0, error: 'Only http(s) URLs are allowed' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await undiciFetch(url, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: controller.signal
    })
    return await readCappedBody(res, controller)
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
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
  const agent = new Agent({
    // undici's LookupFunction type can't express the `all:true` overload; cast is safe (see guardedLookup).
    connect: { lookup: guardedLookup as unknown as LookupFunction, timeout: FETCH_TIMEOUT_MS }
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let current = url
  try {
    // hop 0..MAX_REDIRECTS = 1 initial request + up to MAX_REDIRECTS follows.
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
          await res.body?.cancel() // release the connection before following the redirect
          current = new URL(loc, current).toString()
          continue // re-validate the new host + re-run the IP guard on the next connect
        }
      }
      return await readCappedBody(res, controller)
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
