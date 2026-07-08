import { protocol, type Protocol, type Session } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'

/**
 * `garret://<id>/<path>` serves an extension's built UI. One scheme for both tiers; the CSP differs
 * by tier: web is strict (no inline script), full-access allows inline (hand-written UIs are common
 * and the host holds the real power anyway). `connect-src 'none'` in both — network goes through the
 * broker (`g.fetch`) or the host, never the UI directly.
 */
export const EXT_SCHEME = 'garret'
/** The session partition every extension guest webview loads under (board + surface windows). The
 *  single source of truth — imported by the lane + surface-window manager (renderer hardcodes it). */
export const EXT_PARTITION = 'persist:garret-ext'
export const extSchemePrivilege = {
  scheme: EXT_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false }
}

/** Declare `garret://` as a privileged (standard + secure) scheme. MUST run before app `ready`. */
export function registerExtScheme(): void {
  protocol.registerSchemesAsPrivileged([extSchemePrivilege])
}

const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/

// One strict CSP for every widget (packs ship built UIs; no inline script). `connect-src 'none'` —
// network goes through the broker (`g.fetch`) or the host, never the UI directly.
function csp(): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "base-uri 'none'"
  ].join('; ')
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
}

interface UiEntry {
  dir: string
  /** surfaceId → that surface's ui dir, served at `<origin>/~<surfaceId>/`. */
  surfaces?: Record<string, string>
}
const uiDirs = new Map<string, UiEntry>()
let resolver: ((id: string) => Promise<UiEntry | null>) | null = null

export function resetUiDirs(entries: Array<{ id: string; dir: string; surfaces?: Record<string, string> }>): void {
  uiDirs.clear()
  for (const e of entries) uiDirs.set(e.id, { dir: e.dir, surfaces: e.surfaces })
}
export function setUiResolver(fn: (id: string) => Promise<UiEntry | null>): void {
  resolver = fn
}

function notFound(): Response {
  return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const id = url.hostname
  if (!SAFE_ID.test(id)) return notFound()
  let entry = uiDirs.get(id)
  if (!entry && resolver) {
    const resolved = await resolver(id)
    if (resolved) {
      uiDirs.set(id, resolved)
      entry = resolved
    }
  }
  if (!entry) return notFound()

  const pathname = decodeURIComponent(url.pathname)
  // `garret://<id>/~<surfaceId>/...` serves a secondary surface's own dir; else the primary ui dir.
  let baseDir = entry.dir
  let rel: string
  const surfaceMatch = /^\/~([a-z0-9][a-z0-9._-]*)(\/.*)?$/.exec(pathname)
  if (surfaceMatch) {
    const sDir = entry.surfaces?.[surfaceMatch[1]]
    if (!sDir) return notFound()
    baseDir = sDir
    rel = surfaceMatch[2] && surfaceMatch[2] !== '/' ? surfaceMatch[2] : '/index.html'
  } else {
    rel = pathname === '/' ? '/index.html' : pathname
  }
  const resolved = normalize(join(baseDir, rel))
  if (resolved !== baseDir && !resolved.startsWith(baseDir + sep)) return notFound()
  try {
    const body = await readFile(resolved)
    const ext = resolved.slice(resolved.lastIndexOf('.'))
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Security-Policy': csp(),
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } catch {
    return notFound()
  }
}

export function registerExtProtocol(target: Protocol | Session['protocol']): void {
  target.handle(EXT_SCHEME, serve)
}
