/**
 * Extension types. One primitive: a Widget. No tiers, no consent — install is one-click; the only
 * risk signal is `hasHost` (a widget shipping a raw-Node host → a passive "can access your computer"
 * warning). Capabilities remain a broker-enforced functional allowlist, not a consent gate. See
 * docs/widget-packs-and-distribution.md.
 */

// ── packs (multiple widgets per package) ─────────────────────────────────────────────────────────

/** Per-widget summary in the pack's install record. Capabilities are enforced per widget at the
 *  broker; `hasHost` marks a widget with system access (the warning). */
export interface WidgetMeta {
  /** widget key, unique within the pack. */
  id: string
  /** the permanent identity `${packId}/${id}`. */
  fullId: string
  name: string
  capabilities: string[]
  hasHost: boolean
  defaultSize?: { w: number; h: number }
}

/** HMAC-signed install record — ONE per installed pack. `capabilities` is the union (for display). */
export interface PackRecord {
  id: string
  publisher: string
  version: string
  source: string
  sha256: string
  capabilities: string[]
  enabled: boolean
  installedAt: number
  /** shipped with the app + auto-installed on first run → non-removable. */
  bundled?: boolean
  widgets: WidgetMeta[]
  mac?: string
}

/** Where a pack came from — drives update checks + the marketplace (P2). */
export type PackSourceKind = 'local' | 'git' | 'npm' | 'registry'

/** One entry in the marketplace (a curated GitHub registry index → each pack's prebuilt .garret). */
export interface MarketplaceEntry {
  id: string
  name: string
  publisher: string
  description?: string
  version: string
  /** https URL of the prebuilt .garret to install. */
  url: string
  /** ships a host (system access) → show the warning before install. */
  hasHost: boolean
  /** already installed locally. */
  installed: boolean
}

/** A validated pack-install proposal. Install is one-click; `hasHost` drives the passive warning. */
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
  hasHost: boolean
  capabilities: string[]
  widgets: WidgetMeta[]
  isUpdate: boolean
  sourceHash: string
  staged?: boolean
}

/** A widget within an installed pack, as the manager/catalog sees it. */
export interface InstalledPackWidget {
  fullId: string
  id: string
  name: string
  hasHost: boolean
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
  /** any widget ships a host → the pack carries the host-access warning. */
  hasHost: boolean
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
  /** garret://<widgetId>.<packId>/ — this widget's own origin (per-widget storage partition). */
  uiOrigin: string
  uiDir: string
  nodeEntry?: string
  capabilities: string[]
  defaultSize?: { w: number; h: number }
  /** the pack declares a shared settings namespace → this widget's host gets GARRET_PACK_SHARED_DIR. */
  hasShared: boolean
}

/** A validated install proposal (mapped from a pack plan for the existing install IPC). */
export interface ExtInstallPlan {
  ok: boolean
  error?: string
  id: string
  name: string
  description?: string
  version: string
  source: string
  capabilities: string[]
  /** widget ships a raw-Node host (system access) → passive warning. */
  hasHost: boolean
  isUpdate: boolean
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
  hasHost: boolean
  enabled: boolean
  /** Files no longer match the recorded hash (tamper/corruption) — will not run. */
  tampered: boolean
  /** The record's HMAC verified (authentic, not forged in userData). False → treated disabled. */
  integrityOk: boolean
  defaultSize?: { w: number; h: number }
}

/** What the board loader needs to place + render an enabled widget. */
export interface ExtRuntimeInfo {
  id: string
  name: string
  /** garret://<widgetId>.<packId>/ — the UI origin. */
  uiUrl: string
  /** the widget ships a host process (system access) → passive warning. */
  hasHost: boolean
  capabilities: string[]
  defaultSize?: { w: number; h: number }
}
