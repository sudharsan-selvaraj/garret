import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { validateManifest, MANIFEST_FILE, type Issue } from '@garretapp/pack-schema'

// The app's install-time asset caps (keep in sync with src/main/ext/install.ts).
const ICON_MAX = 512 * 1024
const PREVIEW_MAX = 2 * 1024 * 1024

const err = (code: string, path: string, message: string): Issue => ({ level: 'error', code, path, message })
const warn = (code: string, path: string, message: string): Issue => ({ level: 'warn', code, path, message })

export async function readManifest(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8')) as Record<string, unknown>
}

async function statOf(p: string): Promise<'file' | 'dir' | null> {
  try {
    return (await stat(p)).isDirectory() ? 'dir' : 'file'
  } catch {
    return null
  }
}

/** Candidate on-disk locations for a manifest (build-relative) path, so audit works before OR after a
 *  build: the built path itself, plus its source equivalent (`dist/host/*`→`host/index.ts`, `dist/X`→`ui/X`). */
function candidates(dir: string, rel: string): string[] {
  const out = [join(dir, rel)]
  if (rel.startsWith('dist/host/')) out.push(join(dir, 'host', 'index.ts'))
  else if (rel.startsWith('dist/')) out.push(join(dir, 'ui', rel.slice(5)))
  return out
}

async function anyExists(paths: string[], want: 'file' | 'dir'): Promise<boolean> {
  for (const p of paths) if ((await statOf(p)) === want) return true
  return false
}

/**
 * Audit a pack directory: the shared rulebook (validateManifest) + the filesystem checks the app does
 * at install (referenced files exist, asset sizes) + a light CSP sanity pass. Returns all issues.
 * Runs on a source pack (pre-build) or a built one — ui/host paths resolve to either layout.
 */
export async function auditPack(dir: string): Promise<Issue[]> {
  let m: Record<string, unknown>
  try {
    m = await readManifest(dir)
  } catch {
    return [err('manifest.read', MANIFEST_FILE, `No readable ${MANIFEST_FILE} in ${dir}`)]
  }

  const issues = validateManifest(m)
  // A malformed manifest already failed the rulebook — don't pile on fs noise.
  if (issues.some((i) => i.level === 'error')) return issues

  const widgets = (m.widgets as Array<Record<string, unknown>>) ?? []
  for (let i = 0; i < widgets.length; i++) {
    const w = widgets[i]
    const wp = `widgets[${i}]`
    const wid = String(w.id)

    const uiPaths = candidates(dir, String(w.ui)).map((p) => join(p, 'index.html'))
    if (!(await anyExists(uiPaths, 'file'))) {
      issues.push(err('ui.missing', `${wp}.ui`, `widget "${wid}": no index.html found (built ${w.ui}/ or source ui/…)`))
    } else {
      await cspSanity(uiPaths, `${wp}.ui`, wid, issues)
    }

    if (w.host !== undefined && !(await anyExists(candidates(dir, String(w.host)), 'file'))) {
      issues.push(err('host.missing', `${wp}.host`, `widget "${wid}": host not found (built ${w.host} or source host/index.ts)`))
    }

    for (const [sid, s] of Object.entries((w.surfaces as Record<string, { ui?: unknown }>) ?? {})) {
      const sPaths = candidates(dir, String(s.ui)).map((p) => join(p, 'index.html'))
      if (!(await anyExists(sPaths, 'file'))) {
        issues.push(err('surface.missing', `${wp}.surfaces.${sid}.ui`, `widget "${wid}": surface "${sid}" has no index.html`))
      }
    }

    if (typeof w.preview === 'string') await checkAsset(dir, w.preview, PREVIEW_MAX, `${wp}.preview`, `widget "${wid}" preview`, issues)
  }

  if (typeof m.icon === 'string') await checkAsset(dir, m.icon, ICON_MAX, 'icon', 'icon', issues)
  const readme = typeof m.readme === 'string' ? m.readme : undefined
  if (readme && (await statOf(join(dir, readme))) !== 'file') {
    issues.push(err('readme.missing', 'readme', `readme "${readme}" not found`))
  }

  return issues
}

async function checkAsset(dir: string, rel: string, max: number, path: string, label: string, issues: Issue[]): Promise<void> {
  const p = join(dir, rel)
  if ((await statOf(p)) !== 'file') {
    issues.push(err('asset.missing', path, `${label} "${rel}" not found`))
    return
  }
  const size = (await stat(p)).size
  if (size > max) {
    issues.push(err('asset.tooBig', path, `${label} "${rel}" is ${(size / 1024).toFixed(0)} KB — exceeds ${(max / 1024).toFixed(0)} KB (the app drops it)`))
  }
}

/** Warn on UI HTML that the strict pack CSP (script-src 'self') will break: remote or inline scripts. */
async function cspSanity(indexHtmlPaths: string[], path: string, wid: string, issues: Issue[]): Promise<void> {
  for (const p of indexHtmlPaths) {
    let html: string
    try {
      html = await readFile(p, 'utf8')
    } catch {
      continue
    }
    if (/<script\b[^>]*\bsrc\s*=\s*["']https?:/i.test(html)) {
      issues.push(warn('csp.remoteScript', path, `widget "${wid}": ui loads a remote <script> — blocked by the pack CSP (script-src 'self')`))
    }
    if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html)) {
      issues.push(warn('csp.inlineScript', path, `widget "${wid}": ui has an inline <script> — blocked by the pack CSP; move it to a file`))
    }
    return // only the first existing candidate
  }
}
