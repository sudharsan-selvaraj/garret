import type { MarketplaceEntry } from '@shared/types/ext'
import { listInstalledPacks } from '@main/ext/install'

/**
 * The marketplace is a curated registry INDEX — a JSON file in a GitHub repo listing packs, each
 * pointing at a prebuilt `.garret` (a GitHub Release asset). No server: Garret fetches the raw index,
 * shows it, and installs the chosen pack's URL through the normal verify pipeline (planPackInstallFromUrl).
 * Override the index for dev via GARRET_MARKETPLACE_URL.
 */
const INDEX_URL =
  process.env.GARRET_MARKETPLACE_URL ||
  'https://raw.githubusercontent.com/sudharsan-selvaraj/garret-widgets/main/index.json'

const PACK_ID_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

export async function fetchMarketplaceIndex(): Promise<MarketplaceEntry[]> {
  const res = await fetch(INDEX_URL)
  if (!res.ok) throw new Error(`Marketplace unavailable (HTTP ${res.status})`)
  const raw = (await res.json()) as unknown
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { widgets?: unknown }).widgets)
      ? (raw as { widgets: unknown[] }).widgets
      : []
  const installed = new Set((await listInstalledPacks()).map((p) => p.id))
  const out: MarketplaceEntry[] = []
  for (const e of list) {
    const x = (e ?? {}) as Record<string, unknown>
    if (typeof x.id !== 'string' || !PACK_ID_RE.test(x.id)) continue
    if (typeof x.name !== 'string' || !x.name) continue
    if (typeof x.url !== 'string' || !/^https:\/\//i.test(x.url)) continue
    out.push({
      id: x.id,
      name: x.name,
      publisher: typeof x.publisher === 'string' ? x.publisher : x.id.split('.')[0],
      description: typeof x.description === 'string' ? x.description : undefined,
      version: typeof x.version === 'string' ? x.version : '0.0.0',
      url: x.url,
      hasHost: x.hasHost === true,
      installed: installed.has(x.id)
    })
  }
  return out
}
