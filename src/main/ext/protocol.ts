import { protocol, type Protocol, type Session } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { WIDGET_THEME_CSS } from '@main/ext/theme'

/**
 * `garret://<id>/<path>` serves an extension's built UI. One scheme for both tiers; the CSP differs
 * by tier: web is strict (no inline script), full-access allows inline (hand-written UIs are common
 * and the host holds the real power anyway). `connect-src 'none'` in both — network goes through the
 * broker (`g.fetch`) or the host, never the UI directly.
 */
const EXT_SCHEME = 'garret'
/** The session partition every extension guest webview loads under (board + surface windows). The
 *  single source of truth — imported by the lane + surface-window manager (renderer hardcodes it). */
export const EXT_PARTITION = 'persist:garret-ext'
/** The isolated session a widget's embedded external `<webview>` (`embed` capability) loads under —
 *  never the ext partition, so untrusted sites can't touch widget storage/cookies. No Garret preload. */
export const EXT_EMBED_PARTITION = 'persist:garret-embed'
const extSchemePrivilege = {
  scheme: EXT_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false }
}

/** Declare `garret://` as a privileged (standard + secure) scheme. MUST run before app `ready`. */
export function registerExtScheme(): void {
  protocol.registerSchemesAsPrivileged([extSchemePrivilege])
}

const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/

// One strict CSP for every widget (packs ship built UIs; no inline script). `connect-src 'none'` —
// network goes through the broker (`g.fetch`) or the host, never the UI directly. Widgets with the
// `embed` capability additionally get `frame-src https:` so their isolated <webview> can load real
// sites (Chromium enforces the embedder's frame-src on <webview>, same as the board renderer).
function csp(embed: boolean): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'none'",
    embed ? "frame-src https:" : "frame-src 'none'",
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
  /** Widget declares the `embed` capability → relax CSP to allow an https <webview>. */
  embed?: boolean
}
const uiDirs = new Map<string, UiEntry>()
let resolver: ((id: string) => Promise<UiEntry | null>) | null = null

export function resetUiDirs(
  entries: Array<{ id: string; dir: string; surfaces?: Record<string, string>; embed?: boolean }>
): void {
  uiDirs.clear()
  for (const e of entries) uiDirs.set(e.id, { dir: e.dir, surfaces: e.surfaces, embed: e.embed })
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
  // Reserved: the shared widget theme, served on EVERY widget origin (so `style-src 'self'` allows a
  // `<link href="~theme.css">`). It's static + public, so cache it hard. Must come before the file/
  // surface resolution — it's generated, not a file in the pack.
  if (url.pathname === '/~theme.css') {
    return new Response(WIDGET_THEME_CSS, {
      status: 200,
      headers: {
        'Content-Type': 'text/css',
        'Content-Security-Policy': csp(false),
        // Never cache: the theme ships WITH the app, so a cached copy would pin an old look after an
        // app update. It's a tiny same-origin (garret://) asset — refetching per load is free.
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  }
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
        'Content-Security-Policy': csp(entry.embed ?? false),
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
