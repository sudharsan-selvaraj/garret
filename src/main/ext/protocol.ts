import { type Protocol, type Session } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import type { ExtTier } from '@shared/types/ext'

/**
 * `garret://<id>/<path>` serves an extension's built UI. One scheme for both tiers; the CSP differs
 * by tier: web is strict (no inline script), full-access allows inline (hand-written UIs are common
 * and the host holds the real power anyway). `connect-src 'none'` in both — network goes through the
 * broker (`g.fetch`) or the host, never the UI directly.
 */
export const EXT_SCHEME = 'garret'
export const extSchemePrivilege = {
  scheme: EXT_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false }
}

const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/

function csp(tier: ExtTier): string {
  const script = tier === 'full' ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'"
  return [
    "default-src 'none'",
    script,
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
  tier: ExtTier
}
const uiDirs = new Map<string, UiEntry>()
let resolver: ((id: string) => Promise<UiEntry | null>) | null = null

export function resetUiDirs(entries: Array<{ id: string; dir: string; tier: ExtTier }>): void {
  uiDirs.clear()
  for (const e of entries) uiDirs.set(e.id, { dir: e.dir, tier: e.tier })
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
  const rel = pathname === '/' ? '/index.html' : pathname
  const resolved = normalize(join(entry.dir, rel))
  if (resolved !== entry.dir && !resolved.startsWith(entry.dir + sep)) return notFound()
  try {
    const body = await readFile(resolved)
    const ext = resolved.slice(resolved.lastIndexOf('.'))
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Security-Policy': csp(entry.tier),
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
