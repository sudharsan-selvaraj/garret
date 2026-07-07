/**
 * Unified extension types (one path for web widgets + native extensions). The tier is DERIVED from
 * declared capabilities, never chosen. See docs/architecture.md and docs/garret.html.
 */

/** web = sandboxed/limited (no host); full = raw-Node host + full system access (consent, default-OFF). */
export type ExtTier = 'web' | 'full'

// ── v2 packs (multiple widgets per package; see docs/widget-packs-and-distribution.md) ───────────

/** Per-widget summary in the pack's install record. Capability ENFORCEMENT is per widget (each host
 *  gets only its own widget's caps), even though consent is shown once per pack. */
export interface WidgetMeta {
  /** widget key, unique within the pack. */
  id: string
  /** the permanent identity `${packId}/${id}`. */
  fullId: string
  name: string
  tier: ExtTier
  capabilities: string[]
  hasHost: boolean
  defaultSize?: { w: number; h: number }
}

/** HMAC-signed install record — ONE per installed pack. Pack-level version/source/enabled; the
 *  per-widget caps live in `widgets[]`. `capabilities` is the union, for display/consent only. */
export interface PackRecord {
  id: string
  publisher: string
  version: string
  source: string
  sha256: string
  tier: ExtTier
  capabilities: string[]
  enabled: boolean
  installedAt: number
  widgets: WidgetMeta[]
  mac?: string
}

/** Where a pack came from — drives the danger wall (git/npm full-tier) + update checks (P2). */
export type PackSourceKind = 'local' | 'git' | 'npm' | 'registry'

/** A validated pack-install proposal shown before any files are written (consent is per pack; the
 *  per-widget caps in `widgets[]` are what actually gets enforced at each host launch). */
export interface PackInstallPlan {
  ok: boolean
  error?: string
  id: string
  publisher: string
  name: string
  description?: string
  version: string
  source: string
  sourceKind: PackSourceKind
  tier: ExtTier
  capabilities: string[]
  widgets: WidgetMeta[]
  isUpdate: boolean
  codeChanged: boolean
  addedCapabilities: string[]
  sourceHash: string
  staged?: boolean
}

/** A widget within an installed pack, as the manager/catalog sees it. */
export interface InstalledPackWidget {
  fullId: string
  id: string
  name: string
  tier: ExtTier
  capabilities: string[]
  defaultSize?: { w: number; h: number }
}

/** An installed pack as the manager sees it. */
export interface InstalledPack {
  id: string
  publisher: string
  name: string
  version: string
  description?: string
  icon?: string
  source: string
  tier: ExtTier
  capabilities: string[]
  enabled: boolean
  tampered: boolean
  integrityOk: boolean
  widgets: InstalledPackWidget[]
}

/** What the board loader + host launch need for ONE placeable widget of an enabled pack. */
export interface WidgetRuntimeInfo {
  fullId: string
  packId: string
  widgetId: string
  name: string
  tier: ExtTier
  /** garret://<widgetId>.<packId>/ — this widget's own origin (per-widget storage partition). */
  uiOrigin: string
  uiDir: string
  nodeEntry?: string
  capabilities: string[]
  defaultSize?: { w: number; h: number }
  /** the pack declares a shared settings namespace → this widget's host gets GARRET_PACK_SHARED_DIR. */
  hasShared: boolean
}

/** A validated install proposal shown before any files are written. */
export interface ExtInstallPlan {
  ok: boolean
  error?: string
  id: string
  name: string
  description?: string
  version: string
  source: string
  /** Declared capabilities (validated, normalized). The authoritative ceiling once committed. */
  capabilities: string[]
  tier: ExtTier
  isUpdate: boolean
  /** True when the code differs from a prior install (sha delta) → re-consent (full tier). */
  codeChanged: boolean
  /** Capabilities not in the prior consented set → re-consent if non-empty. */
  addedCapabilities: string[]
  /** Full-tree integrity hash at plan time (re-checked at commit). */
  sourceHash: string
  /** True when `source` is a host-owned temp dir (from a `.garret`) to clean up after. */
  staged?: boolean
}

/** An installed extension as the manager sees it. */
export interface InstalledExtension {
  id: string
  name: string
  version: string
  description?: string
  icon?: string
  source: string
  capabilities: string[]
  tier: ExtTier
  enabled: boolean
  /** Files no longer match the recorded hash (tamper/corruption) — will not run. */
  tampered: boolean
  /** The record's HMAC verified (authentic, not forged in userData). False → treated disabled. */
  integrityOk: boolean
  defaultSize?: { w: number; h: number }
}

/** What the board loader needs to place + render an enabled extension. */
export interface ExtRuntimeInfo {
  id: string
  name: string
  tier: ExtTier
  /** garret://<id>/ — the UI origin. */
  uiUrl: string
  /** true if this extension has a host process (full tier). */
  hasHost: boolean
  capabilities: string[]
  defaultSize?: { w: number; h: number }
}
