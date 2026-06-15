/**
 * Canonical, stable key for a poll job: same (serviceId, method, params) always
 * yields the same string regardless of object key order or `undefined`/function
 * values — so identical queries coalesce into one job. Used by both main and SDK.
 */
export function canonicalKey(
  serviceId: string,
  method: string,
  params: Record<string, unknown>
): string {
  return `${serviceId}::${method}::${canonical(params)}`
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'function') return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
}
