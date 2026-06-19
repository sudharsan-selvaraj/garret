/**
 * A unique id, without assuming `crypto.randomUUID` (only guaranteed in secure contexts —
 * a sandboxed realm may not qualify). Ids only correlate a request/subscription with its
 * response within one realm, so the fallback's uniqueness is sufficient.
 */
export function uid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  return c && typeof c.randomUUID === 'function'
    ? c.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
