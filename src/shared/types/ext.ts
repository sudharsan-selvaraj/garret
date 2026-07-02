/**
 * Unified extension types (one path for web widgets + native extensions). The tier is DERIVED from
 * declared capabilities, never chosen. See docs/architecture.md and docs/garret.html.
 */

/** web = sandboxed/limited (no host); full = raw-Node host + full system access (consent, default-OFF). */
export type ExtTier = 'web' | 'full'

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
