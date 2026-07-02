import { join, normalize, sep } from 'node:path'
import { readFile } from 'node:fs/promises'
import { app, protocol, type Protocol, type Session } from 'electron'
import { nativeSchemePrivilege } from '@main/native/protocol'
import { extSchemePrivilege } from '@main/ext/protocol'

/**
 * Custom scheme that serves sandboxed third-party widget bundles. Each widget gets a
 * distinct origin `garret-widget://<id>` (cross-widget isolation), served with a strict
 * CSP **response header** (not a <meta> tag) so the policy is reliably enforced.
 *
 * See docs/sandbox-design.md §3. Phase 3 step 1.
 */
export const SANDBOX_SCHEME = 'garret-widget'

/**
 * The widget realm's Content-Security-Policy. `script-src 'self'` loads only the
 * same-origin bundle (no eval, no remote scripts); `connect-src 'none'` means the
 * widget cannot reach the network on its own — all I/O must go through the host bridge,
 * where declared permissions are enforced.
 *
 * `img-src 'self'` lets a widget render raster images it ships in its OWN bundle (served by
 * this protocol handler) — there's no provenance/exfil risk: a remote `<img>` is forbidden,
 * `data:` is deliberately NOT allowed (covert-channel surface), and `connect-src 'none'`
 * still blocks every outbound request. Everything else stays locked to 'none'.
 */
export const WIDGET_CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; " +
  "media-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; " +
  "child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; " +
  "form-action 'none'; frame-ancestors 'none'"

/** Where staged/installed widget files live: <userData>/widgets/<id>/… (Phase 4 writes here). */
export function sandboxWidgetsDir(): string {
  return join(app.getPath('userData'), 'widgets')
}

/** A widget id is part of the origin + a directory name. Leading alphanumeric + lowercase
 *  charset means no `..`/leading-dot path forms can reach the filesystem (defense in depth;
 *  install validation is the primary gate). */
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain',
  // Bundled images (img-src 'self') — correct types matter because we send nosniff.
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}

function notFound(): Response {
  return new Response('not found', { status: 404, headers: { 'Content-Security-Policy': WIDGET_CSP } })
}

/**
 * Resolve `garret-widget://<id>/<path>` to a file under that widget's directory and
 * serve it with the CSP header. Rejects bad ids and any path that escapes the widget
 * directory (traversal). `/` maps to `index.html`.
 */
export async function serveSandboxRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const widgetId = url.hostname
  if (!SAFE_ID.test(widgetId)) return notFound()

  const base = join(sandboxWidgetsDir(), widgetId)
  const rel = decodeURIComponent(url.pathname) === '/' ? '/index.html' : decodeURIComponent(url.pathname)
  const resolved = normalize(join(base, rel))
  // Containment: the resolved path must stay inside the widget's own directory.
  if (resolved !== base && !resolved.startsWith(base + sep)) return notFound()

  try {
    const body = await readFile(resolved)
    const ext = resolved.slice(resolved.lastIndexOf('.'))
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Security-Policy': WIDGET_CSP,
        // The widget origin must never be treated as the host; deny embedding it elsewhere.
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } catch {
    return notFound()
  }
}

/**
 * Declare the scheme as privileged. MUST be called at module load, BEFORE app `ready`
 * (Electron ignores it afterwards). `standard:true` gives a real (non-opaque) origin so
 * `script-src 'self'` resolves and the CSP is enforced; `secure:true` makes it a secure
 * context (so `crypto.randomUUID` etc. work in the widget realm).
 */
export function registerSandboxScheme(): void {
  // registerSchemesAsPrivileged may only be called once, so register the native-extension
  // scheme here too (both are privileged custom schemes serving widget/extension UIs).
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SANDBOX_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false }
    },
    nativeSchemePrivilege,
    extSchemePrivilege
  ])
}

/**
 * Register the protocol handler on a session (the default session, and — in step 5 —
 * each widget's partition session, since custom-protocol handlers are per-session).
 */
export function registerSandboxProtocol(target: Protocol | Session['protocol']): void {
  target.handle(SANDBOX_SCHEME, serveSandboxRequest)
}
