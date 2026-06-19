/** An installed sandboxed widget as the renderer sees it (from the install record). */
export interface InstalledWidget {
  id: string
  /** Display fields only (name/description/size/icon) — NOT trusted for permissions. */
  manifest: Record<string, unknown>
  /** Authoritative permission ceiling — from the host-written install record. */
  consentedPermissions: string[]
  enabled: boolean
}

/** A validated install proposal shown on the consent screen before any files are written. */
export interface InstallPlan {
  ok: boolean
  error?: string
  id: string
  name: string
  description?: string
  version: string
  source: string
  /** Declared permissions (normalized). Becomes the consent ceiling if confirmed. */
  permissions: string[]
  isUpdate: boolean
  /** Permissions not in the prior consented set — re-consent required if non-empty. */
  addedPermissions: string[]
  /** Source-tree integrity hash at plan time (re-checked at commit). */
  sourceHash: string
}
