import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { WireMessage } from '@garretapp/sdk'

/**
 * Preload injected into an extension's UI webview. Exposes `window.__garret` — the GarretRuntime the
 * SDK (`@garretapp/sdk/ui` + `/react`) reads. The guest binds ITSELF (main keys on the unforgeable
 * e.sender + verifies the garret://<id>/ origin), then platform calls / host frames flow over IPC.
 *
 * Channel strings are HARDCODED (self-contained preload): importing a shared module makes Rollup
 * emit a chunk the preload loader can't resolve. Keep in sync with Channels.ext*.
 */
const BIND = 'ext:bind'
const HOST_SEND = 'ext:host-send'
const HOST_FRAME = 'ext:host-frame'
const PLATFORM = 'ext:platform'
const ACTIVE = 'ext:active'
const CONFIG = 'ext:config'
const CONFIG_CHANGE = 'ext:config-change'

const extId = location.hostname
const instanceId = new URLSearchParams(location.search).get('instance') || 'unknown'

// ── host transport (full tier): a raw WireMessage pipe ───────────────────────────────────────────
// OUTBOUND is buffered until bind resolves (the host isn't launched yet). INBOUND is buffered until
// the SDK client attaches its first onMessage, so a host frame relayed before the client mounts
// (e.g. an initial 'event') isn't dropped (review S1).
const frameCbs = new Set<(m: WireMessage) => void>()
const inbound: WireMessage[] = []
let hasSubscriber = false
ipcRenderer.on(HOST_FRAME, (_e: IpcRendererEvent, msg: WireMessage) => {
  if (hasSubscriber) frameCbs.forEach((cb) => cb(msg))
  else inbound.push(msg)
})
let bound = false
const sendQueue: WireMessage[] = []
const hostTransport = {
  send(msg: WireMessage): void {
    if (bound) ipcRenderer.send(HOST_SEND, msg)
    else sendQueue.push(msg) // flushed once bind() resolves + the host is launched
  },
  onMessage(cb: (m: WireMessage) => void): () => void {
    frameCbs.add(cb)
    if (!hasSubscriber) {
      hasSubscriber = true
      for (const m of inbound.splice(0)) cb(m)
    }
    return () => frameCbs.delete(cb)
  }
}

// ── platform capabilities (all main-brokered + capability-gated) ─────────────────────────────────
const call = (domain: string, op: string, args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(PLATFORM, domain, op, args)
const storage = (domain: string): Record<string, unknown> => ({
  get: (k: string) => call(domain, 'get', [k]),
  set: (k: string, v: unknown) => call(domain, 'set', [k, v]),
  delete: (k: string) => call(domain, 'delete', [k]),
  keys: () => call(domain, 'keys', []),
  clear: () => call(domain, 'clear', [])
})

// ── active signal ────────────────────────────────────────────────────────────────────────────────
let active = true
const activeCbs = new Set<(a: boolean) => void>()
ipcRenderer.on(ACTIVE, (_e: IpcRendererEvent, a: boolean) => {
  active = a
  activeCbs.forEach((cb) => cb(a))
})

// ── config (per-placement settings) ──────────────────────────────────────────────────────────────
let config: unknown = {}
const configCbs = new Set<(c: unknown) => void>()
ipcRenderer.on(CONFIG_CHANGE, (_e: IpcRendererEvent, c: unknown) => {
  config = c
  configCbs.forEach((cb) => cb(c))
})

const runtime = {
  instanceId,
  hostTransport,
  storage: storage('storage'),
  instanceStorage: storage('instanceStorage'),
  secrets: {
    get: (k: string) => call('secrets', 'get', [k]),
    set: (k: string, v: string) => call('secrets', 'set', [k, v]),
    delete: (k: string) => call('secrets', 'delete', [k])
  },
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const r = (await call('fetch', '', [url, init])) as {
      status: number
      statusText: string
      headers: Record<string, string>
      bodyBytes: Uint8Array
    }
    return new Response(r.bodyBytes as unknown as BodyInit, {
      status: r.status,
      statusText: r.statusText,
      headers: r.headers
    })
  },
  service: (id: string) => ({
    status: () => call('service', 'status', [id]),
    query: (method: string, params?: unknown) => call('service', 'query', [id, method, params])
  }),
  notify: (title: string, body?: string) => void call('notify', '', [title, body]),
  openExternal: (url: string) => call('openExternal', '', [url]) as Promise<boolean>,
  clipboard: {
    readText: () => call('clipboard', 'readText', []) as Promise<string>,
    writeText: (v: string) => call('clipboard', 'writeText', [v]) as Promise<void>
  },
  get active(): boolean {
    return active
  },
  onActiveChange(cb: (a: boolean) => void): () => void {
    activeCbs.add(cb)
    return () => activeCbs.delete(cb)
  },
  inGarret: true,
  config: {
    get: () => config,
    set: (value: unknown, replace = false) => void ipcRenderer.invoke(CONFIG, 'set', value, replace),
    subscribe(cb: (c: unknown) => void): () => void {
      configCbs.add(cb)
      return () => configCbs.delete(cb)
    }
  }
}

contextBridge.exposeInMainWorld('__garret', runtime)

// Bind (and fetch initial config) after exposing, then flush any queued host frames.
void (async () => {
  try {
    const res = (await ipcRenderer.invoke(BIND, extId, instanceId)) as { ok: boolean; hasHost?: boolean }
    config = await ipcRenderer.invoke(CONFIG, 'get')
    configCbs.forEach((cb) => cb(config))
    if (res?.ok) {
      bound = true
      for (const msg of sendQueue.splice(0)) ipcRenderer.send(HOST_SEND, msg)
    }
  } catch {
    /* not bound — host calls will surface UNAVAILABLE via the SDK client */
  }
})()
