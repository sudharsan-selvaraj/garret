import { normalize, join, sep } from 'node:path'
import { lstat, readFile } from 'node:fs/promises'
import type { SettingsField, NotifierSpec } from '@shared/types/ext'

/**
 * Parse + validate `garret.manifest.json` into the trusted spec. One primitive: a Widget (no tiers).
 * A widget optionally ships a `host` (raw Node → `hasHost`, the warning); `capabilities` is a
 * broker-enforced functional allowlist. See docs/guide/07-sdk-reference.md.
 */

export const MANIFEST_FILE = 'garret.manifest.json'
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/

// ── v2 pack identity (locked; see docs/guide/07-sdk-reference.md) ─────────────────────────
const PACK_API_VERSION = 2
/** A single dns-label-ish segment: lowercase alnum, internal hyphens. */
const SEG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
/** A settings/config field key — a plain identifier (camelCase, snake, kebab all fine). It's only a
 *  storage-object key, so it needn't follow the dns-label rules that IDs/origins do. */
const SETTING_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/
/** publisher = one segment; packId = publisher + ≥1 dotted segments (e.g. `acme.devtools`). */
const isSegment = (s: string): boolean => SEG_RE.test(s)
function isPackId(id: string, publisher: string): boolean {
  const parts = id.split('.')
  return parts.length >= 2 && parts.every(isSegment) && parts[0] === publisher
}

/** Capabilities Garret implements (a functional allowlist; anything else is rejected at install).
 *  `process`/`fs`/`native` are accepted but are effectively implied by shipping a host. */
// `embed` = the widget renders an isolated <webview> onto arbitrary https pages (loads sites that
// block iframes). Rendering privilege, not a broker call: it enables webviewTag on the widget's
// surface + frame-src https in its CSP. Isolated partition, no Node, no Garret preload.
const SIMPLE_CAPS = new Set(['storage', 'secrets', 'notify', 'clipboard', 'openExternal', 'process', 'fs', 'native', 'windows', 'embed'])

/** A secondary, non-placeable UI surface a widget can open as a floating window (same package only). */
export interface SurfaceSpec {
  name: string
  /** absolute, contained. */
  uiDir: string
  /** window size in PX (not grid units). */
  defaultSize?: { w: number; h: number }
  minSize?: { w: number; h: number }
  resizable: boolean
  /** native window chrome (title bar); default true. */
  frame: boolean
  /** transparent background — for non-rectangular UIs (e.g. a phone screen); default false. */
  transparent: boolean
}

/** Lenient `{ w, h }` numeric size (grid units for the primary widget), or undefined. */
function pxSize(v: unknown): { w: number; h: number } | undefined {
  const s = v as { w?: unknown; h?: unknown } | undefined
  return s && typeof s.w === 'number' && typeof s.h === 'number' ? { w: s.w, h: s.h } : undefined
}

const MAX_SURFACES = 16
const MIN_WIN_PX = 120
const MAX_WIN_PX = 8000

/** A window size in PX: integers within sane bounds. Returns null if PRESENT but invalid (→ reject). */
function winSize(v: unknown): { w: number; h: number } | null {
  const s = v as { w?: unknown; h?: unknown } | undefined
  if (!s || typeof s.w !== 'number' || typeof s.h !== 'number') return null
  if (!Number.isInteger(s.w) || !Number.isInteger(s.h)) return null
  if (s.w < MIN_WIN_PX || s.h < MIN_WIN_PX || s.w > MAX_WIN_PX || s.h > MAX_WIN_PX) return null
  return { w: s.w, h: s.h }
}

/** Validate a manifest-relative path is contained (no absolute, no `..`); strips trailing sep. */
function containedPath(base: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(rel)) return null
  let p = normalize(join(base, rel))
  while (p.length > 1 && p.endsWith(sep)) p = p.slice(0, -1)
  return p === base || p.startsWith(base + sep) ? p : null
}

/** Returns the normalized capability, or null if unknown/unimplemented (rejected). */
function normalizeCapability(c: unknown): string | null {
  if (typeof c !== 'string') return null
  if (SIMPLE_CAPS.has(c)) return c
  if (/^network:\S+$/.test(c)) return `network:${c.slice(8).toLowerCase()}`
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PACKS (multiple widgets per package). apiVersion 2 is THE manifest format (v1 single-widget
// manifests are rejected with a repack hint). A pack has a publisher-namespaced id; each widget has
// its own ui/host/caps/tier/surfaces and a permanent full id `${packId}/${widgetId}`. See
// docs/guide/07-sdk-reference.md.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export interface WidgetSpec {
  /** widget key, unique within the pack (single segment, no dots/slashes). */
  id: string
  /** the permanent identity `${packId}/${id}` — the board layout + storage key. */
  fullId: string
  name: string
  description?: string
  icon?: string
  uiDir: string
  /** present ⇒ the widget ships a raw-Node host (system access → the warning). */
  nodeEntry?: string
  capabilities: string[]
  defaultSize?: { w: number; h: number }
  surfaces?: Record<string, SurfaceSpec>
  settingsSchema?: SettingsField[]
  notifier?: NotifierSpec
}

export interface PackSpec {
  /** publisher-namespaced pack id (e.g. `acme.devtools`). */
  id: string
  publisher: string
  name: string
  version: string
  description?: string
  icon?: string
  widgets: WidgetSpec[]
  /** opt-in pack-shared settings schema (values live in `ext-data/<packId>/_shared/`). */
  shared?: { settingsSchema?: SettingsField[] }
  /** union of widget caps — for display; enforcement is per-widget at the broker. */
  capabilities: string[]
}

function parseSettingsSchema(v: unknown): SettingsField[] | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v)) return undefined
  const out: SettingsField[] = []
  for (const raw of v) {
    const f = raw as Partial<SettingsField>
    if (typeof f.key !== 'string' || !SETTING_KEY_RE.test(f.key)) continue
    if (typeof f.label !== 'string' || !f.label) continue
    if (!['string', 'secret', 'number', 'boolean', 'select'].includes(f.type as string)) continue
    out.push({
      key: f.key,
      label: f.label,
      type: f.type as SettingsField['type'],
      options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === 'string') : undefined,
      default: typeof f.default === 'string' || typeof f.default === 'number' || typeof f.default === 'boolean' ? f.default : undefined,
      placeholder: typeof f.placeholder === 'string' ? f.placeholder : undefined
    })
  }
  return out.length ? out : undefined
}

/** Validate one widget's surfaces (contained, own subdir, index.html). Mirrors the v1 rules. */
async function parseSurfacesFor(
  base: string,
  widgetUiDir: string,
  nodeEntry: string | undefined,
  raw: unknown
): Promise<Record<string, SurfaceSpec> | { error: string }> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'surfaces must be an object' }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_SURFACES) return { error: `Too many surfaces (max ${MAX_SURFACES})` }
  const out: Record<string, SurfaceSpec> = {}
  for (const [sid, sraw] of entries) {
    if (!ID_RE.test(sid)) return { error: `Invalid surface id: ${sid}` }
    const s = sraw as { name?: unknown; ui?: unknown; defaultSize?: unknown; minSize?: unknown; resizable?: unknown }
    if (typeof s.name !== 'string' || !s.name) return { error: `surface "${sid}" requires a name` }
    const sDir = containedPath(base, s.ui)
    if (!sDir) return { error: `surface "${sid}" ui must be a path inside the extension (no "..")` }
    if (sDir === base || sDir === widgetUiDir) {
      return { error: `surface "${sid}" ui must be its own subdirectory, not the pack root or the widget ui` }
    }
    if (nodeEntry && (nodeEntry === sDir || nodeEntry.startsWith(sDir + sep))) {
      return { error: `surface "${sid}" ui must not contain the host entry` }
    }
    try {
      if (!(await lstat(sDir)).isDirectory()) return { error: `surface "${sid}" ui is not a directory` }
      if (!(await lstat(join(sDir, 'index.html'))).isFile()) return { error: `surface "${sid}" ui must contain index.html` }
    } catch {
      return { error: `surface "${sid}" ui / index.html not found` }
    }
    const defaultSize = s.defaultSize !== undefined ? winSize(s.defaultSize) : undefined
    if (s.defaultSize !== undefined && !defaultSize) return { error: `surface "${sid}" defaultSize must be integer px in [${MIN_WIN_PX}, ${MAX_WIN_PX}]` }
    const minSize = s.minSize !== undefined ? winSize(s.minSize) : undefined
    if (s.minSize !== undefined && !minSize) return { error: `surface "${sid}" minSize must be integer px in [${MIN_WIN_PX}, ${MAX_WIN_PX}]` }
    if (defaultSize && minSize && (minSize.w > defaultSize.w || minSize.h > defaultSize.h)) {
      return { error: `surface "${sid}" minSize exceeds defaultSize` }
    }
    out[sid] = {
      name: s.name,
      uiDir: sDir,
      defaultSize: defaultSize ?? undefined,
      minSize: minSize ?? undefined,
      resizable: s.resizable !== false,
      frame: (s as { frame?: unknown }).frame !== false,
      transparent: (s as { transparent?: unknown }).transparent === true
    }
  }
  return out
}

async function parseWidget(base: string, packId: string, raw: unknown): Promise<WidgetSpec | { error: string }> {
  const w = raw as Record<string, unknown>
  const id = typeof w.id === 'string' ? w.id.toLowerCase() : ''
  if (!isSegment(id)) return { error: `widget id must be a single lowercase segment (a-z0-9-): "${String(w.id)}"` }
  if (typeof w.name !== 'string' || !w.name) return { error: `widget "${id}" requires a name` }

  const uiDir = containedPath(base, w.ui)
  if (!uiDir) return { error: `widget "${id}" ui must be a path inside the pack (no "..")` }
  try {
    if (!(await lstat(uiDir)).isDirectory()) return { error: `widget "${id}" ui is not a directory` }
    if (!(await lstat(join(uiDir, 'index.html'))).isFile()) return { error: `widget "${id}" ui must contain index.html` }
  } catch {
    return { error: `widget "${id}" ui / index.html not found` }
  }

  let nodeEntry: string | undefined
  if (w.host !== undefined) {
    const p = containedPath(base, w.host)
    if (!p) return { error: `widget "${id}" host must be a path inside the pack (no "..")` }
    try {
      if (!(await lstat(p)).isFile()) return { error: `widget "${id}" host not found` }
    } catch {
      return { error: `widget "${id}" host not found` }
    }
    nodeEntry = p
  }

  const capabilities: string[] = []
  for (const c of Array.isArray(w.capabilities) ? w.capabilities : []) {
    const norm = normalizeCapability(c)
    if (!norm) return { error: `widget "${id}": unsupported capability ${String(c)}` }
    capabilities.push(norm)
  }
  let surfaces: Record<string, SurfaceSpec> | undefined
  if (w.surfaces !== undefined) {
    const s = await parseSurfacesFor(base, uiDir, nodeEntry, w.surfaces)
    if ('error' in s) return { error: `widget "${id}": ${s.error}` }
    if (Object.keys(s).length > 0) {
      if (!capabilities.includes('windows')) return { error: `widget "${id}": declaring surfaces requires the "windows" capability` }
      surfaces = s
    }
  }

  return {
    id,
    fullId: `${packId}/${id}`,
    name: w.name,
    description: typeof w.description === 'string' ? w.description : undefined,
    icon: typeof w.icon === 'string' ? w.icon : undefined,
    uiDir,
    nodeEntry,
    capabilities,
    defaultSize: pxSize(w.defaultSize),
    surfaces,
    settingsSchema: parseSettingsSchema((w.settings as { schema?: unknown })?.schema),
    notifier: parseNotifier(w.notifier)
  }
}

/** Best-effort parse of the optional declarative background-notifier spec. A malformed notifier is
 *  dropped (returns undefined) rather than failing the whole install — it just won't fire. */
function parseNotifier(v: unknown): NotifierSpec | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const n = v as Partial<NotifierSpec>
  const req = n.request as NotifierSpec['request'] | undefined
  if (!req || typeof req.url !== 'string') return undefined
  if (typeof n.idField !== 'string' || typeof n.titleTemplate !== 'string') return undefined
  return {
    auth: n.auth,
    request: {
      url: req.url,
      method: typeof req.method === 'string' ? req.method : undefined,
      headers: req.headers,
      body: typeof req.body === 'string' ? req.body : undefined
    },
    itemsPath: typeof n.itemsPath === 'string' ? n.itemsPath : undefined,
    idField: n.idField,
    titleTemplate: n.titleTemplate,
    bodyTemplate: typeof n.bodyTemplate === 'string' ? n.bodyTemplate : undefined,
    urlTemplate: typeof n.urlTemplate === 'string' ? n.urlTemplate : undefined,
    intervalMin: typeof n.intervalMin === 'number' ? n.intervalMin : undefined
  }
}

/** Parse + validate a v2 pack manifest. v1 (single-widget) manifests are rejected with a repack hint. */
export async function parsePack(dir: string): Promise<PackSpec | { error: string }> {
  const base = normalize(dir)
  let m: Record<string, unknown>
  try {
    m = JSON.parse(await readFile(join(base, MANIFEST_FILE), 'utf8')) as Record<string, unknown>
  } catch {
    return { error: `No readable ${MANIFEST_FILE} in that folder` }
  }

  const apiVersion = typeof m.apiVersion === 'number' ? m.apiVersion : 0
  if (apiVersion > PACK_API_VERSION) return { error: 'This pack needs a newer version of Garret' }
  if (apiVersion < PACK_API_VERSION || !Array.isArray(m.widgets)) {
    return { error: `This widget uses the old single-widget format. Repack it as an apiVersion-${PACK_API_VERSION} pack (a "widgets" array).` }
  }

  const publisher = typeof m.publisher === 'string' ? m.publisher.toLowerCase() : ''
  if (!isSegment(publisher)) return { error: 'manifest.publisher must be a single lowercase segment (a-z0-9-)' }
  const id = typeof m.id === 'string' ? m.id.toLowerCase() : ''
  if (!isPackId(id, publisher)) return { error: `manifest.id must be "${publisher}.<name>" (publisher-namespaced, lowercase)` }
  if (typeof m.name !== 'string' || !m.name) return { error: 'manifest.name required' }
  if ((m.widgets as unknown[]).length === 0) return { error: 'a pack must declare at least one widget' }

  const widgets: WidgetSpec[] = []
  const seen = new Set<string>()
  for (const raw of m.widgets as unknown[]) {
    const w = await parseWidget(base, id, raw)
    if ('error' in w) return w
    if (seen.has(w.id)) return { error: `duplicate widget id "${w.id}" in pack` }
    seen.add(w.id)
    widgets.push(w)
  }

  const capabilities = [...new Set(widgets.flatMap((w) => w.capabilities))]

  let shared: PackSpec['shared']
  if (m.shared !== undefined) {
    const schema = parseSettingsSchema((m.shared as { settings?: { schema?: unknown } })?.settings?.schema)
    shared = { settingsSchema: schema }
  }

  return {
    id,
    publisher,
    name: m.name,
    version: typeof m.version === 'string' ? m.version : '0.0.0',
    description: typeof m.description === 'string' ? m.description : undefined,
    icon: typeof m.icon === 'string' ? m.icon : undefined,
    widgets,
    shared,
    capabilities
  }
}
