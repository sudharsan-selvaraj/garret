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
const SURFACE_OPEN = 'ext:surface-open'
const SURFACE_CLOSE = 'ext:surface-close'
const SURFACE_FOCUS = 'ext:surface-focus'
const SURFACE_CLOSED = 'ext:surface-closed'
const SURFACE_SET_ASPECT = 'ext:surface-set-aspect'
const SURFACE_RESIZE = 'ext:surface-resize'
const SURFACE_SELF_CLOSE = 'ext:surface-self-close'
const SET_COMMANDS = 'ext:set-commands'
const COMMAND = 'ext:command'
const SET_TITLE = 'ext:set-title'

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

// ── command bus (frame ⋯ menu → the widget) ──────────────────────────────────────────────────────
const commandCbs = new Set<(id: string) => void>()
ipcRenderer.on(COMMAND, (_e: IpcRendererEvent, id: string) => commandCbs.forEach((cb) => cb(id)))

// ── surfaces (floating sibling windows) + launch props + ready ─────────────────────────────────────
let launchProps: Record<string, unknown> = {}
let ready = false
const readyCbs = new Set<(props: Record<string, unknown>) => void>()
const surfaceClosedCbs = new Set<(id: string) => void>()
ipcRenderer.on(SURFACE_CLOSED, (_e: IpcRendererEvent, id: string) => surfaceClosedCbs.forEach((cb) => cb(id)))

const surfaces = {
  async open(surfaceId: string, opts?: unknown): Promise<unknown> {
    const res = (await ipcRenderer.invoke(SURFACE_OPEN, surfaceId, opts)) as {
      ok: boolean
      instanceId?: string
      error?: string
    }
    if (!res?.ok || !res.instanceId) throw new Error(res?.error || 'could not open surface')
    const id = res.instanceId
    const onCloseCbs = new Set<() => void>()
    let resolveClosed = (): void => {}
    const closedP = new Promise<void>((r) => (resolveClosed = r))
    const route = (closedId: string): void => {
      if (closedId !== id) return
      onCloseCbs.forEach((cb) => cb())
      resolveClosed()
      surfaceClosedCbs.delete(route)
    }
    surfaceClosedCbs.add(route)
    return {
      id,
      close: () => ipcRenderer.invoke(SURFACE_CLOSE, id) as Promise<boolean>,
      focus: () => ipcRenderer.invoke(SURFACE_FOCUS, id) as Promise<boolean>,
      closed: () => closedP,
      onClose: (cb: () => void): (() => void) => {
        onCloseCbs.add(cb)
        return () => onCloseCbs.delete(cb)
      }
    }
  },
  // Global close observer for THIS opener's surfaces. Unlike a handle's onClose/closed() (scoped to
  // the current context), this survives an opener reload: the fresh context re-subscribes and main
  // delivers closes to the re-pointed opener wc. Use it for reload-durable tracking.
  onClosed(cb: (instanceId: string) => void): () => void {
    surfaceClosedCbs.add(cb)
    return () => surfaceClosedCbs.delete(cb)
  }
}

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
  // Pack-shared store (only if the pack declared `shared`) — one namespace across the pack's widgets,
  // e.g. a single credential set for a multi-widget service pack.
  shared: {
    storage: storage('sharedStorage'),
    secrets: {
      get: (k: string) => call('sharedSecrets', 'get', [k]),
      set: (k: string, v: string) => call('sharedSecrets', 'set', [k, v]),
      delete: (k: string) => call('sharedSecrets', 'delete', [k])
    }
  },
  // NB: returns a Response-LIKE object, not a real `Response`. contextBridge can't clone a Response
  // across the isolated-world boundary (the guest would receive a stripped `{}`), so we hand back a
  // plain object with primitive fields + proxied text()/json()/arrayBuffer() methods (functions ARE
  // proxied by contextBridge). Covers the common `res.ok`/`res.status`/`res.json()` usage.
  async fetch(
    url: string,
    init?: RequestInit
  ): Promise<{
    ok: boolean
    status: number
    statusText: string
    headers: Record<string, string>
    text(): Promise<string>
    json(): Promise<unknown>
    arrayBuffer(): Promise<ArrayBuffer>
  }> {
    const r = (await call('fetch', '', [url, init])) as {
      status: number
      statusText: string
      headers: Record<string, string>
      bodyBytes: Uint8Array
    }
    const bytes = r.bodyBytes instanceof Uint8Array ? r.bodyBytes : new Uint8Array(r.bodyBytes ?? [])
    const decode = (): string => new TextDecoder().decode(bytes)
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: r.statusText,
      headers: r.headers,
      text: async () => decode(),
      json: async () => JSON.parse(decode()),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    }
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
  // Declare the commands this widget wants in the frame's ⋯ menu (id + label). The frame renders them
  // and dispatches the chosen one to onCommand — one generic mechanism for settings/refresh/anything.
  setCommands: (commands: { id: string; label: string }[]) => void ipcRenderer.invoke(SET_COMMANDS, commands),
  onCommand(cb: (id: string) => void): () => void {
    commandCbs.add(cb)
    return () => commandCbs.delete(cb)
  },
  // Set this placement's title in the board frame header (persisted in the board config).
  setTitle: (title: string) => void ipcRenderer.invoke(SET_TITLE, title),
  surfaces,
  // Controls for THIS UI's own surface window (no-op for board widgets — main scopes it to the
  // embedder). A surface uses this once it knows its content size (e.g. the device resolution).
  window: {
    setAspectRatio: (ratio: number, inset?: { width?: number; height?: number }): void =>
      ipcRenderer.send(SURFACE_SET_ASPECT, ratio, inset),
    resize: (width: number, height: number): void => ipcRenderer.send(SURFACE_RESIZE, width, height),
    close: (): void => ipcRenderer.send(SURFACE_SELF_CLOSE)
  },
  // Launch props are delivered through onReady's CALLBACK (a getter would be frozen at contextBridge
  // exposure time — before bind resolves — so `get props()` would always read `{}`). Same reason the
  // config/active APIs use functions/callbacks, not getters.
  onReady(cb: (props: Record<string, unknown>) => void): () => void {
    if (ready) {
      cb(launchProps)
      return () => {}
    }
    readyCbs.add(cb)
    return () => readyCbs.delete(cb)
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
    const res = (await ipcRenderer.invoke(BIND, extId, instanceId)) as {
      ok: boolean
      hasHost?: boolean
      props?: Record<string, unknown>
    }
    launchProps = res?.props && typeof res.props === 'object' ? res.props : {}
    config = await ipcRenderer.invoke(CONFIG, 'get')
    configCbs.forEach((cb) => cb(config))
    if (res?.ok) {
      bound = true
      for (const msg of sendQueue.splice(0)) ipcRenderer.send(HOST_SEND, msg)
    }
  } catch {
    /* not bound — host calls will surface UNAVAILABLE via the SDK client */
  } finally {
    ready = true
    readyCbs.forEach((cb) => cb(launchProps))
    readyCbs.clear()
  }
})()
