import { type Protocol, type Session } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'

/**
 * `garret-native://<id>/<path>` serves a native extension's UI files. A custom standard scheme
 * (not file://, which a webview can't load from the app's origin). CSP is relaxed vs. the sandbox
 * tier — native extensions are trusted/full-access, so the UI may use inline scripts/styles; the
 * raw power lives in the Node host regardless. `connect-src 'none'` still steers I/O through the
 * bridge/host rather than the UI making its own requests.
 */
export const NATIVE_SCHEME = 'garret-native'
export const nativeSchemePrivilege = {
  scheme: NATIVE_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false }
}

const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/
const NATIVE_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'none'; base-uri 'none'"

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}

// id → the extension's UI directory (set by the lane at registration).
const uiDirs = new Map<string, string>()
export function setNativeUiDir(id: string, dir: string): void {
  uiDirs.set(id, dir)
}

function notFound(): Response {
  return new Response('not found', { status: 404, headers: { 'Content-Security-Policy': NATIVE_CSP } })
}

async function serveNativeRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const id = url.hostname
  const base = uiDirs.get(id)
  if (!SAFE_ID.test(id) || !base) return notFound()
  const rel = decodeURIComponent(url.pathname) === '/' ? '/index.html' : decodeURIComponent(url.pathname)
  const resolved = normalize(join(base, rel))
  if (resolved !== base && !resolved.startsWith(base + sep)) return notFound() // containment
  try {
    const body = await readFile(resolved)
    const ext = resolved.slice(resolved.lastIndexOf('.'))
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Security-Policy': NATIVE_CSP,
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } catch {
    return notFound()
  }
}

export function registerNativeProtocol(target: Protocol | Session['protocol']): void {
  target.handle(NATIVE_SCHEME, serveNativeRequest)
}
