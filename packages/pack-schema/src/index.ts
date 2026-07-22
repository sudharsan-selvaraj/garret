/**
 * @garretapp/pack-schema — the single source of truth for the Garret pack manifest.
 *
 * Pure: no `fs`, no `electron`, zero runtime deps. Both the app's install path and the `garret` CLI
 * import this so `garret audit` enforces exactly what the app accepts. Anything that needs the
 * filesystem (does `ui/index.html` exist, byte sizes, HMAC) stays with whoever holds the files.
 *
 * `validateManifest()` validates the DECLARATION (shape, ids, capabilities, path containment + path
 * relationships, sizes, dedup). It returns every issue it finds; callers decide how to surface them.
 */

export const MANIFEST_FILE = 'garret.manifest.json'

// ── pack identity (apiVersion 2 is THE format; v1 single-widget manifests are rejected) ──────────
export const PACK_API_VERSION = 2

/** A single dns-label-ish segment: lowercase alnum, internal hyphens. */
const SEG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
/** A surface id — lenient: lowercase alnum with `._-`. */
const SURFACE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/
/** A settings/config field key — a plain identifier (camel/snake/kebab). Only a storage-object key. */
const SETTING_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/

export const isSegment = (s: string): boolean => SEG_RE.test(s)
/** publisher = one segment; packId = publisher + ≥1 dotted segments (e.g. `acme.devtools`). */
export function isPackId(id: string, publisher: string): boolean {
  const parts = id.split('.')
  return parts.length >= 2 && parts.every(isSegment) && parts[0] === publisher
}

// ── capabilities (a functional allowlist; anything else is rejected) ──────────────────────────────
// `embed` = the widget renders an isolated <webview> onto arbitrary https pages. `process`/`fs`/
// `native` are accepted but effectively implied by shipping a host.
export const SIMPLE_CAPS: ReadonlySet<string> = new Set([
  'storage', 'secrets', 'notify', 'clipboard', 'openExternal', 'process', 'fs', 'native', 'windows', 'embed'
])

/** Returns the normalized capability, or null if unknown/unimplemented (→ rejected). */
export function normalizeCapability(c: unknown): string | null {
  if (typeof c !== 'string') return null
  if (SIMPLE_CAPS.has(c)) return c
  if (/^network:\S+$/.test(c)) return `network:${c.slice(8).toLowerCase()}`
  return null
}

// ── sizes ────────────────────────────────────────────────────────────────────────────────────────
export const MAX_SURFACES = 16
export const MIN_WIN_PX = 120
export const MAX_WIN_PX = 8000

/** Lenient `{ w, h }` numeric size (grid units for the primary widget), or undefined. */
export function pxSize(v: unknown): { w: number; h: number } | undefined {
  const s = v as { w?: unknown; h?: unknown } | undefined
  return s && typeof s.w === 'number' && typeof s.h === 'number' ? { w: s.w, h: s.h } : undefined
}

/** A window size in PX: integers within sane bounds. Returns null if PRESENT but invalid (→ reject). */
export function winSize(v: unknown): { w: number; h: number } | null {
  const s = v as { w?: unknown; h?: unknown } | undefined
  if (!s || typeof s.w !== 'number' || typeof s.h !== 'number') return null
  if (!Number.isInteger(s.w) || !Number.isInteger(s.h)) return null
  if (s.w < MIN_WIN_PX || s.h < MIN_WIN_PX || s.w > MAX_WIN_PX || s.h > MAX_WIN_PX) return null
  return { w: s.w, h: s.h }
}

// ── path containment (pure string/path math — no fs) ─────────────────────────────────────────────
/** A manifest-relative path that stays inside the pack: a non-empty string, not absolute, no `..`. */
export function isContainedRel(rel: unknown): rel is string {
  return typeof rel === 'string' && !!rel && !rel.startsWith('/') && !/(^|\/)\.\.(\/|$)/.test(rel)
}
/** Normalize a contained relative path for relationship checks (root → ''). Assumes `isContainedRel`. */
export function normRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter((s) => s && s !== '.').join('/')
}

// ── declared shapes shared with the app + renderer ───────────────────────────────────────────────
export interface SettingsField {
  key: string
  label: string
  type: 'string' | 'secret' | 'number' | 'boolean' | 'select'
  options?: string[]
  default?: string | number | boolean
  placeholder?: string
}

/** Declarative background-notifier spec (manifest `notifier`). A single shared main-process runner
 *  polls this on a schedule, diffs new items vs a seen set, and fires a click-through notification.
 *  Templates: `{shared.KEY}` / `{secret.KEY}` in auth + request; `{item.dot.path}` in title/body/url. */
export interface NotifierSpec {
  /** Authorization header, computed at runtime from the pack's shared store. */
  auth?: { type: 'basic'; user: string; pass: string } | { type: 'bearer'; token: string }
  request: { url: string; method?: string; headers?: Record<string, string>; body?: string }
  /** dot-path to the array of items in the JSON response (omit if the root is the array). */
  itemsPath?: string
  /** field (dot-path) within each item that uniquely identifies it. */
  idField: string
  /** notification title (per-item `{item.…}` templates). */
  titleTemplate: string
  bodyTemplate?: string
  /** click-through target (`{item.…}` / `{shared.…}`). */
  urlTemplate?: string
  /** poll cadence in minutes (default 5; floored to 5 when the board is idle). */
  intervalMin?: number
}

/** Lenient parse of a settings schema. Invalid fields are DROPPED (never fatal) — matches install. */
export function parseSettingsSchema(v: unknown): SettingsField[] | undefined {
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
      default:
        typeof f.default === 'string' || typeof f.default === 'number' || typeof f.default === 'boolean'
          ? f.default
          : undefined,
      placeholder: typeof f.placeholder === 'string' ? f.placeholder : undefined
    })
  }
  return out.length ? out : undefined
}

/** Best-effort parse of the optional notifier spec. Malformed → undefined (dropped, never fatal). */
export function parseNotifier(v: unknown): NotifierSpec | undefined {
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

// ── the validator ────────────────────────────────────────────────────────────────────────────────
export interface Issue {
  level: 'error' | 'warn'
  code: string
  /** dot/bracket path into the manifest, e.g. `widgets[0].capabilities[1]`. */
  path: string
  message: string
}

/**
 * Validate a parsed manifest object against every rule that does NOT need the filesystem. Returns all
 * issues (errors + warnings). An empty (error-free) result means the DECLARATION is valid; the caller
 * still verifies that the referenced files exist on disk.
 */
export function validateManifest(m: unknown): Issue[] {
  const issues: Issue[] = []
  const err = (code: string, path: string, message: string): void => {
    issues.push({ level: 'error', code, path, message })
  }
  const warn = (code: string, path: string, message: string): void => {
    issues.push({ level: 'warn', code, path, message })
  }

  if (typeof m !== 'object' || m === null || Array.isArray(m)) {
    err('manifest.shape', '', `${MANIFEST_FILE} must be a JSON object`)
    return issues
  }
  const man = m as Record<string, unknown>

  const apiVersion = typeof man.apiVersion === 'number' ? man.apiVersion : 0
  if (apiVersion > PACK_API_VERSION) {
    err('apiVersion.tooNew', 'apiVersion', 'This pack needs a newer version of Garret')
    return issues
  }
  if (apiVersion < PACK_API_VERSION || !Array.isArray(man.widgets)) {
    err(
      'apiVersion.legacy',
      'apiVersion',
      `This widget uses the old single-widget format. Repack it as an apiVersion-${PACK_API_VERSION} pack (a "widgets" array).`
    )
    return issues
  }

  const publisher = typeof man.publisher === 'string' ? man.publisher.toLowerCase() : ''
  if (!isSegment(publisher)) {
    err('publisher.format', 'publisher', 'manifest.publisher must be a single lowercase segment (a-z0-9-)')
  }
  const id = typeof man.id === 'string' ? man.id.toLowerCase() : ''
  if (!isPackId(id, publisher)) {
    err('id.format', 'id', `manifest.id must be "${publisher}.<name>" (publisher-namespaced, lowercase)`)
  }
  if (typeof man.name !== 'string' || !man.name) err('name.required', 'name', 'manifest.name required')

  const widgets = man.widgets as unknown[]
  if (widgets.length === 0) err('widgets.empty', 'widgets', 'a pack must declare at least one widget')

  const seen = new Set<string>()
  widgets.forEach((raw, i) => {
    const wp = `widgets[${i}]`
    const w = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const wid = typeof w.id === 'string' ? w.id.toLowerCase() : ''
    if (!isSegment(wid)) {
      err('widget.id', `${wp}.id`, `widget id must be a single lowercase segment (a-z0-9-): "${String(w.id)}"`)
    }
    if (typeof w.name !== 'string' || !w.name) err('widget.name', `${wp}.name`, `widget "${wid}" requires a name`)

    if (!isContainedRel(w.ui)) {
      err('widget.ui', `${wp}.ui`, `widget "${wid}" ui must be a path inside the pack (no "..")`)
    }
    if (w.host !== undefined && !isContainedRel(w.host)) {
      err('widget.host', `${wp}.host`, `widget "${wid}" host must be a path inside the pack (no "..")`)
    }

    const caps: string[] = []
    const rawCaps = Array.isArray(w.capabilities) ? w.capabilities : []
    rawCaps.forEach((c, ci) => {
      const norm = normalizeCapability(c)
      if (!norm) err('widget.capability', `${wp}.capabilities[${ci}]`, `widget "${wid}": unsupported capability ${String(c)}`)
      else caps.push(norm)
    })

    if (w.surfaces !== undefined) {
      validateSurfaces(w.surfaces, w.ui, w.host, caps, wid, wp, err)
    }

    // Lenient: a malformed settings/notifier is dropped at install (never fatal) — flag as a warning
    // so `garret audit` can surface it without failing the build.
    if (w.settings !== undefined && (w.settings as { schema?: unknown }).schema !== undefined) {
      if (!parseSettingsSchema((w.settings as { schema?: unknown }).schema)) {
        warn('widget.settings', `${wp}.settings.schema`, `widget "${wid}": settings.schema has no valid fields (ignored)`)
      }
    }
    if (w.notifier !== undefined && !parseNotifier(w.notifier)) {
      warn('widget.notifier', `${wp}.notifier`, `widget "${wid}": notifier is malformed (ignored — it won't fire)`)
    }

    if (wid && isSegment(wid)) {
      if (seen.has(wid)) err('widget.duplicate', `${wp}.id`, `duplicate widget id "${wid}" in pack`)
      seen.add(wid)
    }
  })

  if (man.shared !== undefined) {
    const schema = (man.shared as { settings?: { schema?: unknown } })?.settings?.schema
    if (schema !== undefined && !parseSettingsSchema(schema)) {
      warn('shared.settings', 'shared.settings.schema', 'shared settings.schema has no valid fields (ignored)')
    }
  }

  return issues
}

function validateSurfaces(
  raw: unknown,
  widgetUi: unknown,
  widgetHost: unknown,
  caps: string[],
  wid: string,
  wp: string,
  err: (code: string, path: string, message: string) => void
): void {
  const sp = `${wp}.surfaces`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    err('surfaces.shape', sp, `widget "${wid}": surfaces must be an object`)
    return
  }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_SURFACES) {
    err('surfaces.max', sp, `widget "${wid}": Too many surfaces (max ${MAX_SURFACES})`)
    return
  }
  if (entries.length === 0) return

  const widgetUiNorm = isContainedRel(widgetUi) ? normRel(widgetUi) : null
  const hostNorm = isContainedRel(widgetHost) ? normRel(widgetHost) : null

  for (const [sid, sraw] of entries) {
    const p = `${sp}.${sid}`
    if (!SURFACE_ID_RE.test(sid)) {
      err('surface.id', p, `widget "${wid}": Invalid surface id: ${sid}`)
      continue
    }
    const s = sraw as { name?: unknown; ui?: unknown; defaultSize?: unknown; minSize?: unknown }
    if (typeof s.name !== 'string' || !s.name) err('surface.name', `${p}.name`, `widget "${wid}": surface "${sid}" requires a name`)

    if (!isContainedRel(s.ui)) {
      err('surface.ui', `${p}.ui`, `widget "${wid}": surface "${sid}" ui must be a path inside the extension (no "..")`)
    } else {
      const suNorm = normRel(s.ui)
      if (suNorm === '' || suNorm === widgetUiNorm) {
        err('surface.ui.own', `${p}.ui`, `widget "${wid}": surface "${sid}" ui must be its own subdirectory, not the pack root or the widget ui`)
      }
      if (hostNorm && (hostNorm === suNorm || hostNorm.startsWith(suNorm + '/'))) {
        err('surface.ui.host', `${p}.ui`, `widget "${wid}": surface "${sid}" ui must not contain the host entry`)
      }
    }

    const defaultSize = s.defaultSize !== undefined ? winSize(s.defaultSize) : undefined
    if (s.defaultSize !== undefined && !defaultSize) {
      err('surface.defaultSize', `${p}.defaultSize`, `widget "${wid}": surface "${sid}" defaultSize must be integer px in [${MIN_WIN_PX}, ${MAX_WIN_PX}]`)
    }
    const minSize = s.minSize !== undefined ? winSize(s.minSize) : undefined
    if (s.minSize !== undefined && !minSize) {
      err('surface.minSize', `${p}.minSize`, `widget "${wid}": surface "${sid}" minSize must be integer px in [${MIN_WIN_PX}, ${MAX_WIN_PX}]`)
    }
    if (defaultSize && minSize && (minSize.w > defaultSize.w || minSize.h > defaultSize.h)) {
      err('surface.minSize.exceeds', `${p}.minSize`, `widget "${wid}": surface "${sid}" minSize exceeds defaultSize`)
    }
  }

  if (!caps.includes('windows')) {
    err('surfaces.windows', sp, `widget "${wid}": declaring surfaces requires the "windows" capability`)
  }
}
