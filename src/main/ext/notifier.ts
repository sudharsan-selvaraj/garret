import { Notification, shell } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveEnabledWidgetSpecs, sharedDataDir } from '@main/ext/install'
import { getSecret } from '@main/ext/secrets'
import type { NotifierSpec } from '@shared/types/ext'

/**
 * One shared, low-cost background notifier for pack widgets that declare a manifest `notifier` and
 * whose pack has background notifications turned on (shared-store flag `bgNotify`). Runs in MAIN on a
 * timer regardless of whether the widget is placed/mounted — no webview, one interval → negligible
 * cost. Each due widget: resolve the request from the pack's shared store + secrets, fetch (gated by
 * the widget's `network:*` caps), diff new items vs a persisted seen set, and fire a click-through
 * notification (gated by `notify` / `openExternal`). Generic — any pack opts in via its manifest.
 */

const TICK_MS = 60_000
const DEFAULT_INTERVAL_MIN = 5
const MAX_PER_TICK = 5 // cap notifications per widget per run so a first-seen burst can't spam

let timer: ReturnType<typeof setInterval> | null = null
const lastRun = new Map<string, number>() // fullId → epoch ms

interface Ctx {
  packId: string
  shared: Record<string, unknown>
}

function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj)
}

/** Substitute `{shared.KEY}` / `{secret.KEY}` / `{item.dot.path}` templates. */
function tmpl(s: string, ctx: Ctx, item?: unknown): string {
  return s.replace(/\{([^}]+)\}/g, (_m, expr: string) => {
    const dot = expr.indexOf('.')
    if (dot < 0) return ''
    const ns = expr.slice(0, dot)
    const path = expr.slice(dot + 1)
    if (ns === 'shared') return String(ctx.shared[path] ?? '')
    if (ns === 'secret') return String(getSecret(sharedDataDir(ctx.packId), `${ctx.packId}/_shared`, path) ?? '')
    if (ns === 'item' && item !== undefined) return String(getPath(item, path) ?? '')
    return ''
  })
}

function authHeader(spec: NotifierSpec, ctx: Ctx): string | undefined {
  const a = spec.auth
  if (!a) return undefined
  if (a.type === 'basic') return 'Basic ' + Buffer.from(`${tmpl(a.user, ctx)}:${tmpl(a.pass, ctx)}`).toString('base64')
  return 'Bearer ' + tmpl(a.token, ctx)
}

/** Mirrors the broker's `network:*` capability check. */
function netAllowed(caps: string[], url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  return caps.some((c) => {
    if (!c.startsWith('network:')) return false
    const pat = c.slice('network:'.length)
    if (pat === '*') return true
    if (pat.startsWith('*.')) return host === pat.slice(2) || host.endsWith('.' + pat.slice(2))
    return host === pat
  })
}

interface Target {
  packId: string
  widgetId: string
  fullId: string
  capabilities: string[]
  notifier: NotifierSpec
}

async function runOne(t: Target): Promise<void> {
  const ctx: Ctx = { packId: t.packId, shared: readJsonFile(join(sharedDataDir(t.packId), 'storage.json'), {}) }
  if (ctx.shared.bgNotify !== true) return // per-pack opt-in
  if (!t.capabilities.includes('notify')) return

  const spec = t.notifier
  const url = tmpl(spec.request.url, ctx)
  if (!netAllowed(t.capabilities, url)) return

  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(spec.request.headers ?? {})) headers[k] = tmpl(v, ctx)
  const auth = authHeader(spec, ctx)
  if (auth) headers.Authorization = auth

  let items: unknown[]
  try {
    const res = await fetch(url, {
      method: spec.request.method || 'GET',
      headers,
      body: spec.request.body ? tmpl(spec.request.body, ctx) : undefined
    })
    if (!res.ok) return
    const data = await res.json()
    const arr = spec.itemsPath ? getPath(data, spec.itemsPath) : data
    items = Array.isArray(arr) ? arr : []
  } catch {
    return
  }

  const idOf = (it: unknown): string => String(getPath(it, spec.idField) ?? '')
  const ids = items.map(idOf).filter(Boolean)
  const seenFile = join(sharedDataDir(t.packId), `notifier-seen.${t.widgetId}.json`)
  const prev = readJsonFile<string[] | null>(seenFile, null)

  // First run seeds silently (don't notify the whole existing list).
  if (prev && Notification.isSupported()) {
    const prevSet = new Set(prev)
    const fresh = items.filter((it) => idOf(it) && !prevSet.has(idOf(it)))
    for (const it of fresh.slice(0, MAX_PER_TICK)) {
      const n = new Notification({
        title: tmpl(spec.titleTemplate, ctx, it),
        body: spec.bodyTemplate ? tmpl(spec.bodyTemplate, ctx, it) : undefined
      })
      const link = spec.urlTemplate ? tmpl(spec.urlTemplate, ctx, it) : ''
      if (link && /^https?:\/\//i.test(link) && t.capabilities.includes('openExternal')) {
        n.on('click', () => void shell.openExternal(link))
      }
      n.show()
    }
  }

  try {
    mkdirSync(dirname(seenFile), { recursive: true })
    writeFileSync(seenFile, JSON.stringify(ids))
  } catch {
    /* best effort */
  }
}

async function tick(): Promise<void> {
  let widgets: Awaited<ReturnType<typeof resolveEnabledWidgetSpecs>>
  try {
    widgets = await resolveEnabledWidgetSpecs()
  } catch {
    return
  }
  const now = Date.now()
  for (const w of widgets) {
    const notifier = w.widget.notifier
    if (!notifier || !w.hasShared) continue
    const intervalMs = Math.max(notifier.intervalMin ?? DEFAULT_INTERVAL_MIN, 1) * 60_000
    if (now - (lastRun.get(w.fullId) ?? 0) < intervalMs) continue
    lastRun.set(w.fullId, now)
    void runOne({ packId: w.packId, widgetId: w.widgetId, fullId: w.fullId, capabilities: w.capabilities, notifier })
  }
}

/** Start the shared background-notifier loop (idempotent). */
export function startNotifier(): void {
  if (timer) return
  timer = setInterval(() => void tick(), TICK_MS)
  void tick()
}
