/**
 * Native-extension install types (full-access tier). See docs/native-phase3-design.md.
 * Unlike sandboxed widgets there is NO enforced permission model — `declared` is disclosure
 * only, and the authoritative security state is the host-written, HMAC-signed install record
 * (`enabled`), never the user-writable manifest.
 */

/** Author-declared, NOT enforced — shown on the consent screen so the user knows what to expect. */
export interface NativeDeclared {
  /** External binaries the author says it runs (e.g. adb, scrcpy). */
  binaries: string[]
  /** Network destinations the author says it contacts (free-form; often ["*"]). */
  network: string[]
}

/** A validated install proposal — shown before any files are written (mirrors sandbox InstallPlan). */
export interface NativeInstallPlan {
  ok: boolean
  error?: string
  id: string
  name: string
  description?: string
  version: string
  source: string
  declared: NativeDeclared
  isUpdate: boolean
  /** True when the new code differs from the prior install (sha delta) → forces re-consent. */
  codeChanged: boolean
  /** Full-tree integrity hash at plan time (re-checked at commit — TOCTOU guard). */
  sourceHash: string
  /** True when `source` is a host-owned temp dir (from a `.garret`) to clean up after. */
  staged?: boolean
}

/** An installed native extension as the Manage view sees it. */
export interface InstalledExtension {
  id: string
  name: string
  version: string
  /** Where it was installed from (a path). Disclosure, not a trust signal. */
  source: string
  declared: NativeDeclared
  /** Authoritative run state (from the signed record). */
  enabled: boolean
  /** Files no longer match the recorded hash (tamper/corruption) — will not run. */
  tampered: boolean
  /** The record's HMAC verified (authentic, not forged in userData). False → treated as disabled. */
  integrityOk: boolean
  defaultSize?: { w: number; h: number }
}
