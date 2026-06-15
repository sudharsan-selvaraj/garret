import { Notification, powerMonitor, shell, webContents } from 'electron'
import { canonicalKey } from '@shared/poll/key'
import { Channels } from '@shared/ipc/channels'
import type { NotifySpec, PollUpdate, WatchSpec } from '@shared/types/poll'
import { getService } from '@main/services/registry'
import { persistence } from '@main/persistence/store'
import { ServiceError } from '@main/services/types'

const DEFAULT_INTERVAL = 5 * 60 * 1000
const WATCH_INTERVAL = 5 * 60 * 1000
const MIN_INTERVAL = 30 * 1000
const MAX_BACKOFF = 5 * 60 * 1000
const EVICT_GRACE = 15 * 1000
const STAGGER = 350

interface UiSub {
  wcId: number
  intervalMs: number
}

interface Job {
  key: string
  serviceId: string
  method: string
  params: Record<string, unknown>
  intervalMs: number
  uiSubs: Map<string, UiSub>
  watches: Map<string, WatchSpec>
  timer: NodeJS.Timeout | null
  evictTimer: NodeJS.Timeout | null
  inFlight: Promise<void> | null
  lastResult: unknown
  lastHash: string
  lastError: string | null
  lastTs: number
  backoffMs: number
}

const jobs = new Map<string, Job>()
const uiSubIndex = new Map<string, string>() // subId → key
const watchIndex = new Map<string, string>() // watchId → key

// Service-level gates (shared across that service's jobs).
const serviceDisabled = new Map<string, string>() // serviceId → auth error
const servicePausedUntil = new Map<string, number>() // serviceId → epoch ms (429)
let paused = false // system asleep

/* ---------------- public API (called from IPC) ---------------- */

export function subscribe(
  subId: string,
  key: string,
  serviceId: string,
  method: string,
  params: Record<string, unknown>,
  intervalMs: number,
  wcId: number
): PollUpdate {
  const job = ensureJob(key, serviceId, method, params)
  job.uiSubs.set(subId, { wcId, intervalMs })
  uiSubIndex.set(subId, key)
  if (job.evictTimer) {
    clearTimeout(job.evictTimer)
    job.evictTimer = null
  }
  recomputeInterval(job)
  if (job.lastTs === 0) void runJob(job)
  else ensureScheduled(job)
  return cached(job)
}

export function unsubscribe(subId: string): void {
  const key = uiSubIndex.get(subId)
  if (!key) return
  uiSubIndex.delete(subId)
  const job = jobs.get(key)
  if (!job) return
  job.uiSubs.delete(subId)
  afterSubChange(job)
}

export function teardownSender(wcId: number): void {
  for (const [subId, key] of [...uiSubIndex]) {
    const job = jobs.get(key)
    if (job?.uiSubs.get(subId)?.wcId === wcId) {
      job.uiSubs.delete(subId)
      uiSubIndex.delete(subId)
      afterSubChange(job)
    }
  }
}

export function refresh(key: string): void {
  const job = jobs.get(key)
  if (job) void runJob(job)
}

/** Reconcile the full set of background notification watches (from the saved board). */
export function syncWatches(specs: WatchSpec[]): void {
  const incoming = new Map(specs.map((s) => [s.watchId, s]))
  for (const [watchId, key] of [...watchIndex]) {
    if (!incoming.has(watchId)) {
      const job = jobs.get(key)
      job?.watches.delete(watchId)
      watchIndex.delete(watchId)
      if (job) afterSubChange(job)
    }
  }
  for (const spec of specs) {
    const key = canonicalKey(spec.serviceId, spec.method, spec.params)
    const prevKey = watchIndex.get(spec.watchId)
    if (prevKey && prevKey !== key) {
      const prev = jobs.get(prevKey)
      prev?.watches.delete(spec.watchId)
      if (prev) afterSubChange(prev)
    }
    const job = ensureJob(key, spec.serviceId, spec.method, spec.params)
    job.watches.set(spec.watchId, spec)
    watchIndex.set(spec.watchId, key)
    recomputeInterval(job)
    if (job.lastTs === 0) void runJob(job)
    else ensureScheduled(job)
  }
}

/** Re-enable a service after the user reconnects it. */
export function clearServiceGate(serviceId: string): void {
  serviceDisabled.delete(serviceId)
  servicePausedUntil.delete(serviceId)
  let i = 0
  for (const job of jobs.values()) {
    if (job.serviceId === serviceId) scheduleAt(job, i++ * STAGGER)
  }
}

export function initScheduler(): void {
  powerMonitor.on('suspend', () => {
    paused = true
    for (const job of jobs.values()) clearJobTimer(job)
  })
  powerMonitor.on('resume', () => {
    paused = false
    runAllStale()
  })
}

/* ---------------- internals ---------------- */

function ensureJob(
  key: string,
  serviceId: string,
  method: string,
  params: Record<string, unknown>
): Job {
  let job = jobs.get(key)
  if (!job) {
    job = {
      key,
      serviceId,
      method,
      params,
      intervalMs: DEFAULT_INTERVAL,
      uiSubs: new Map(),
      watches: new Map(),
      timer: null,
      evictTimer: null,
      inFlight: null,
      lastResult: undefined,
      lastHash: '',
      lastError: null,
      lastTs: 0,
      backoffMs: 0
    }
    jobs.set(key, job)
  }
  return job
}

function recomputeInterval(job: Job): void {
  let min = Infinity
  for (const s of job.uiSubs.values()) min = Math.min(min, s.intervalMs)
  if (job.watches.size) min = Math.min(min, WATCH_INTERVAL)
  job.intervalMs = Math.max(MIN_INTERVAL, Number.isFinite(min) ? min : DEFAULT_INTERVAL)
}

function afterSubChange(job: Job): void {
  if (job.uiSubs.size === 0 && job.watches.size === 0) {
    clearJobTimer(job)
    if (!job.evictTimer) job.evictTimer = setTimeout(() => evict(job), EVICT_GRACE)
  } else {
    recomputeInterval(job)
  }
}

function evict(job: Job): void {
  if (job.uiSubs.size > 0 || job.watches.size > 0) return
  clearJobTimer(job)
  if (job.evictTimer) clearTimeout(job.evictTimer)
  jobs.delete(job.key)
}

function clearJobTimer(job: Job): void {
  if (job.timer) {
    clearTimeout(job.timer)
    job.timer = null
  }
}

function schedule(job: Job, delay: number): void {
  clearJobTimer(job)
  if (paused || (job.uiSubs.size === 0 && job.watches.size === 0)) return
  const jitter = Math.floor(delay * 0.1 * ((job.key.length % 7) / 7))
  job.timer = setTimeout(() => void runJob(job), delay + jitter)
}

function scheduleAt(job: Job, delay: number): void {
  schedule(job, delay)
}

function ensureScheduled(job: Job): void {
  if (!job.timer && !job.inFlight) schedule(job, job.intervalMs)
}

function runAllStale(): void {
  let i = 0
  const now = Date.now()
  for (const job of jobs.values()) {
    if (now - job.lastTs >= job.intervalMs) scheduleAt(job, i++ * STAGGER)
  }
}

async function runJob(job: Job): Promise<void> {
  if (job.inFlight) return job.inFlight
  if (paused) return
  if (serviceDisabled.has(job.serviceId)) {
    job.lastError = serviceDisabled.get(job.serviceId) ?? 'Service disconnected'
    pushUpdate(job)
    return
  }
  const pausedUntil = servicePausedUntil.get(job.serviceId) ?? 0
  if (Date.now() < pausedUntil) {
    schedule(job, pausedUntil - Date.now())
    return
  }
  clearJobTimer(job)

  job.inFlight = (async () => {
    try {
      const data = await getService(job.serviceId).query(job.method, job.params)
      if (!jobs.has(job.key)) return
      job.lastTs = Date.now()
      job.lastError = null
      job.backoffMs = 0
      const hash = JSON.stringify(data)
      if (hash !== job.lastHash) {
        job.lastResult = data
        job.lastHash = hash
        pushUpdate(job)
      } else {
        job.lastResult = data
      }
      runWatches(job)
      schedule(job, job.intervalMs)
    } catch (err) {
      if (!jobs.has(job.key)) return
      const c = classify(err)
      job.lastError = c.message
      if (c.kind === 'auth') {
        serviceDisabled.set(job.serviceId, c.message)
        pushUpdate(job)
      } else if (c.kind === 'rate') {
        servicePausedUntil.set(job.serviceId, Date.now() + (c.retryAfterMs ?? 60_000))
        pushUpdate(job)
        schedule(job, c.retryAfterMs ?? 60_000)
      } else {
        pushUpdate(job)
        job.backoffMs = Math.min((job.backoffMs || job.intervalMs) * 2, MAX_BACKOFF)
        schedule(job, job.backoffMs)
      }
    } finally {
      job.inFlight = null
    }
  })()
  return job.inFlight
}

function classify(err: unknown): { kind: 'auth' | 'rate' | 'transient'; message: string; retryAfterMs?: number } {
  const e = err as ServiceError
  const message = e?.message ?? 'Request failed'
  if (e?.status === 401 || e?.status === 403) return { kind: 'auth', message }
  if (e?.status === 429) return { kind: 'rate', message, retryAfterMs: e.retryAfterMs }
  return { kind: 'transient', message }
}

function cached(job: Job): PollUpdate {
  return {
    key: job.key,
    data: job.lastError ? undefined : job.lastResult,
    error: job.lastError ?? undefined,
    ts: job.lastTs
  }
}

function pushUpdate(job: Job): void {
  const update = cached(job)
  for (const sub of job.uiSubs.values()) {
    webContents.fromId(sub.wcId)?.send(Channels.pollUpdate, update)
  }
}

/* ---------------- notifications (main-side, per job/watch) ---------------- */

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj)
}

function runWatches(job: Job): void {
  if (!Array.isArray(job.lastResult)) return
  for (const watch of job.watches.values()) {
    detectAndNotify(watch, job.lastResult as unknown[])
  }
}

function detectAndNotify(watch: WatchSpec, items: unknown[]): void {
  const spec = watch.notify
  const hwmKey = `hwm:${watch.watchId}`

  if (spec.createdPath) {
    const stored = persistence.kvGet(hwmKey) as { max?: number } | undefined
    const times = items
      .map((i) => Date.parse(String(getPath(i, spec.createdPath as string))))
      .filter((n) => !Number.isNaN(n))
    const maxNow = times.length ? Math.max(...times) : 0
    if (stored?.max === undefined) {
      persistence.kvSet(hwmKey, { max: maxNow }) // seed: no notification on first run
      return
    }
    for (const item of items) {
      const t = Date.parse(String(getPath(item, spec.createdPath)))
      if (!Number.isNaN(t) && t > stored.max) fire(watch, spec, item)
    }
    if (maxNow > stored.max) persistence.kvSet(hwmKey, { max: maxNow })
    return
  }

  // Fallback: dedupe by id seen-set.
  const ids = items.map((i) => String(getPath(i, spec.idPath)))
  const stored = persistence.kvGet(hwmKey) as { seen?: string[] } | undefined
  if (!stored?.seen) {
    persistence.kvSet(hwmKey, { seen: ids })
    return
  }
  const seen = new Set(stored.seen)
  for (const item of items) {
    if (!seen.has(String(getPath(item, spec.idPath)))) fire(watch, spec, item)
  }
  persistence.kvSet(hwmKey, { seen: [...new Set([...stored.seen, ...ids])].slice(-200) })
}

function fire(watch: WatchSpec, spec: NotifySpec, item: unknown): void {
  if (!Notification.isSupported()) return
  const body = String(getPath(item, spec.titlePath) ?? '')
  const url = spec.urlPath ? String(getPath(item, spec.urlPath) ?? '') : undefined
  const n = new Notification({ title: watch.label, body })
  if (url && /^https?:\/\//i.test(url)) n.on('click', () => void shell.openExternal(url))
  n.show()
}
