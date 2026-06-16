/**
 * Dev-tool registry. Each tool is a tiny pure transform — adding one is ~10 lines
 * and nothing else needs to change. All run locally in the renderer (no network),
 * which matters when the input is a token or payload you shouldn't be sending out.
 */
export type ToolGroup = 'JSON' | 'Encoding' | 'Token' | 'Time' | 'Generate' | 'Hash'

export interface DevTool {
  id: string
  name: string
  group: ToolGroup
  /** Heuristic: does this input look like this tool's domain? (auto-detect) */
  detect?(input: string): boolean
  /** Transform the input. Throw an Error (message shown inline) for bad input. */
  run(input: string): string | Promise<string>
  /** Tools with no input (e.g. UUID). */
  generator?: boolean
}

// ---- base64 / utf-8 helpers -------------------------------------------------

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64.trim())
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function base64UrlToUtf8(b64url: string): string {
  let s = b64url.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return base64ToUtf8(s)
}

// ---- JWT --------------------------------------------------------------------

function decodeJwt(input: string): string {
  const parts = input.trim().split('.')
  if (parts.length < 2) throw new Error('Not a JWT — expected header.payload.signature')
  const header = JSON.parse(base64UrlToUtf8(parts[0]))
  const payload = JSON.parse(base64UrlToUtf8(parts[1]))

  const annotate = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...obj }
    for (const k of ['exp', 'iat', 'nbf', 'auth_time']) {
      if (typeof obj[k] === 'number') out[`${k}·readable`] = new Date((obj[k] as number) * 1000).toLocaleString()
    }
    return out
  }

  const expired =
    typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() ? '   ⚠️ EXPIRED' : ''
  return [
    '// Header',
    JSON.stringify(header, null, 2),
    '',
    `// Payload${expired}`,
    JSON.stringify(annotate(payload), null, 2)
  ].join('\n')
}

// ---- time -------------------------------------------------------------------

function convertTimestamp(input: string): string {
  const t = input.trim()
  const describe = (d: Date): string => {
    if (isNaN(d.getTime())) throw new Error('Invalid date')
    return [
      `ISO:      ${d.toISOString()}`,
      `Local:    ${d.toLocaleString()}`,
      `Unix (s): ${Math.floor(d.getTime() / 1000)}`,
      `Unix (ms): ${d.getTime()}`
    ].join('\n')
  }
  if (/^\d{10}$/.test(t)) return describe(new Date(Number(t) * 1000))
  if (/^\d{13}$/.test(t)) return describe(new Date(Number(t)))
  const ms = Date.parse(t)
  if (!isNaN(ms)) return describe(new Date(ms))
  throw new Error('Enter a Unix timestamp (10 or 13 digits) or a date string')
}

// ---- hash -------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---- registry ---------------------------------------------------------------

export const TOOLS: DevTool[] = [
  {
    id: 'json-format',
    name: 'JSON Format',
    group: 'JSON',
    detect: (s) => /^\s*[[{]/.test(s),
    run: (s) => JSON.stringify(JSON.parse(s), null, 2)
  },
  {
    id: 'json-minify',
    name: 'JSON Minify',
    group: 'JSON',
    run: (s) => JSON.stringify(JSON.parse(s))
  },
  {
    id: 'base64-encode',
    name: 'Base64 Encode',
    group: 'Encoding',
    run: (s) => utf8ToBase64(s)
  },
  {
    id: 'base64-decode',
    name: 'Base64 Decode',
    group: 'Encoding',
    detect: (s) => /^[A-Za-z0-9+/]{12,}={0,2}$/.test(s.trim()) && s.trim().length % 4 === 0,
    run: (s) => base64ToUtf8(s)
  },
  {
    id: 'jwt-decode',
    name: 'JWT Decode',
    group: 'Token',
    detect: (s) => /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/.test(s.trim()),
    run: decodeJwt
  },
  {
    id: 'url-encode',
    name: 'URL Encode',
    group: 'Encoding',
    run: (s) => encodeURIComponent(s)
  },
  {
    id: 'url-decode',
    name: 'URL Decode',
    group: 'Encoding',
    detect: (s) => /%[0-9a-fA-F]{2}/.test(s),
    run: (s) => decodeURIComponent(s)
  },
  {
    id: 'timestamp',
    name: 'Unix Timestamp',
    group: 'Time',
    detect: (s) => /^\d{10}(\d{3})?$/.test(s.trim()),
    run: convertTimestamp
  },
  {
    id: 'sha256',
    name: 'SHA-256',
    group: 'Hash',
    run: sha256Hex
  },
  {
    id: 'uuid',
    name: 'UUID v4',
    group: 'Generate',
    generator: true,
    run: () => crypto.randomUUID()
  }
]

/** First tool whose detector matches the input (used by Auto-detect). */
export function detectTool(input: string): DevTool | null {
  if (!input.trim()) return null
  return TOOLS.find((t) => t.detect?.(input)) ?? null
}
