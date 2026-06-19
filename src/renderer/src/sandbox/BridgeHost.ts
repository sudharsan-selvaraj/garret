import type { GuestMessage, HostMessage, PollUpdate } from 'garret-core'

/**
 * Host (renderer) side of the sandbox bridge — one per sandboxed widget. It is the
 * trust boundary for an untrusted webview: it validates every message, enforces the
 * widget's DECLARED permissions via an explicit method allowlist (never dynamic
 * `window.garret[method]` dispatch), rate-limits, namespaces storage, tracks and
 * forwards the widget's own poll/watch events, and tears everything down on dispose.
 *
 * Main re-checks network independently (resolved-IP gate); secrets never reach here.
 * See docs/sandbox-design.md §6.
 */

interface Permissions {
  services: Set<string>
  networkHosts: string[]
  files: boolean
  openExternal: boolean
}

function parsePermissions(perms: string[] = []): Permissions {
  const out: Permissions = { services: new Set(), networkHosts: [], files: false, openExternal: false }
  for (const p of perms) {
    if (p.startsWith('service:')) out.services.add(p.slice('service:'.length))
    else if (p.startsWith('network:')) out.networkHosts.push(p.slice('network:'.length))
    else if (p === 'files:read') out.files = true
    else if (p === 'openExternal') out.openExternal = true
  }
  return out
}

const MAX_MSG_BYTES = 256 * 1024
const RATE_BURST = 50
const RATE_REFILL_PER_SEC = 20

export interface BridgeHostOptions {
  widgetId: string
  permissions: string[]
  /** Send a message to the guest webview. */
  send: (msg: HostMessage) => void
  /** The widget asked to patch its own config. */
  onUpdateConfig: (patch: Record<string, unknown>) => void
  /** The guest finished booting (sent `ready`). */
  onReady: () => void
}

export class BridgeHost {
  private readonly perms: Permissions
  private readonly widgetId: string
  private readonly send: (msg: HostMessage) => void
  private readonly onUpdateConfig: (patch: Record<string, unknown>) => void
  private readonly onReady: () => void

  private readonly pollSubs = new Map<string, string>() // subId → key
  private readonly pollKeys = new Set<string>() // keys with ≥1 active sub (O(1) forward filter)
  private readonly watchSubs = new Set<string>()
  private readonly blocked = new Set<string>() // undeclared caps the widget tried (disclosure)
  private offPoll?: () => void
  private offWatch?: () => void

  private tokens = RATE_BURST
  private lastRefill = Date.now()
  private disposed = false

  constructor(opts: BridgeHostOptions) {
    this.widgetId = opts.widgetId
    this.perms = parsePermissions(opts.permissions)
    this.send = opts.send
    this.onUpdateConfig = opts.onUpdateConfig
    this.onReady = opts.onReady
  }

  /** Record (once) an undeclared capability the widget attempted; report it for disclosure. */
  private recordBlocked(perm: string): void {
    if (this.blocked.has(perm)) return
    this.blocked.add(perm)
    window.garret.sandbox.recordUsage(this.widgetId, [perm])
  }

  /** Handle a message from the guest. Never throws. */
  handle(msg: GuestMessage): void {
    if (this.disposed) return
    if (msg.kind === 'ready') return this.onReady()
    // Rate-limit FIRST, then size-guard: a flood of oversized messages must be rejected
    // cheaply, before we pay to JSON.stringify attacker-controlled payloads (doing the
    // stringify first is a renderer-thread DoS that freezes the whole board).
    if (!this.takeToken()) {
      if (msg.kind === 'call' && msg.id) this.send({ kind: 'error', id: msg.id, message: 'rate limited' })
      return
    }
    if (JSON.stringify(msg).length > MAX_MSG_BYTES) {
      if (msg.kind === 'call' && msg.id) this.send({ kind: 'error', id: msg.id, message: 'message too large' })
      return
    }
    if (msg.kind === 'updateConfig') {
      return this.onUpdateConfig(msg.patch && typeof msg.patch === 'object' ? msg.patch : {})
    }
    if (msg.kind !== 'call') return
    void this.handleCall(msg)
  }

  private takeToken(): boolean {
    const now = Date.now()
    this.tokens = Math.min(RATE_BURST, this.tokens + ((now - this.lastRefill) / 1000) * RATE_REFILL_PER_SEC)
    this.lastRefill = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }

  private async handleCall(msg: Extract<GuestMessage, { kind: 'call' }>): Promise<void> {
    const { id, method, args } = msg
    try {
      if (!Array.isArray(args)) throw new Error('invalid args')
      const value = await this.dispatch(method, args)
      if (id) this.send({ kind: 'result', id, value })
    } catch (e) {
      if (id) this.send({ kind: 'error', id, message: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Explicit method allowlist + permission enforcement. Unknown/blocked → throws. */
  private dispatch(method: string, args: unknown[]): Promise<unknown> | unknown {
    const g = window.garret
    switch (method) {
      case 'services.query': {
        const [serviceId, m, params] = args as [string, string, Record<string, unknown>]
        this.requireService(serviceId)
        return g.services.query(serviceId, m, params)
      }
      case 'services.status': {
        const [serviceId] = args as [string]
        this.requireService(serviceId)
        return g.services.status(serviceId)
      }
      case 'services.connect':
      case 'services.disconnect':
        // Credentials/auth are host-UI only — never reachable by a sandboxed widget.
        this.recordBlocked('services.connect')
        throw new Error('permission denied: connect/disconnect is host-only')
      case 'poll.subscribe': {
        const [subId, key, serviceId, m, params, intervalMs] = args as [
          string,
          string,
          string,
          string,
          Record<string, unknown>,
          number
        ]
        this.requireService(serviceId)
        this.pollSubs.set(subId, key)
        this.pollKeys.add(key)
        this.ensurePollForwarding()
        // Namespace the subId per widget: the guest chooses it, and the main scheduler
        // indexes subs globally by subId — without this, two widgets reusing the same id
        // (e.g. a per-guest counter "sub-0") would clobber/cancel each other's subscriptions.
        return g.poll.subscribe(this.nsKey(subId), key, serviceId, m, params, intervalMs)
      }
      case 'poll.unsubscribe': {
        const [subId] = args as [string]
        const key = this.pollSubs.get(subId)
        if (key !== undefined) {
          this.pollSubs.delete(subId)
          g.poll.unsubscribe(this.nsKey(subId))
          if (![...this.pollSubs.values()].includes(key)) this.pollKeys.delete(key)
        }
        return undefined
      }
      case 'poll.refresh': {
        const [key] = args as [string]
        if (this.pollKeys.has(key)) g.poll.refresh(key)
        return undefined
      }
      case 'watch.subscribe': {
        const [watchId, paths, opts] = args as [string, string[], Record<string, unknown>]
        if (!this.perms.files) {
          this.recordBlocked('files:read')
          throw new Error('permission denied: files:read')
        }
        this.watchSubs.add(watchId)
        this.ensureWatchForwarding()
        g.watch.subscribe(watchId, paths, opts)
        return undefined
      }
      case 'watch.unsubscribe': {
        const [watchId] = args as [string]
        if (this.watchSubs.has(watchId)) {
          this.watchSubs.delete(watchId)
          g.watch.unsubscribe(watchId)
        }
        return undefined
      }
      case 'fetch': {
        const [url, init] = args as [
          string,
          { method?: string; headers?: Record<string, string>; body?: string } | undefined
        ]
        // Renderer layer: scope to the widget's OWN declared hosts; main re-checks
        // host + resolved IP. No network perms ⇒ empty list ⇒ main denies everything.
        return g.plugins.fetch(url, init, { allowedHosts: this.perms.networkHosts })
      }
      case 'storage.get': {
        const [key] = args as [string]
        return g.store.get(this.nsKey(key))
      }
      case 'storage.set': {
        const [key, val] = args as [string, unknown]
        return g.store.set(this.nsKey(key), val)
      }
      case 'openExternal': {
        const [url] = args as [string]
        if (!this.perms.openExternal) {
          this.recordBlocked('openExternal')
          throw new Error('permission denied: openExternal')
        }
        return g.plugins.openExternalConfirmed(url)
      }
      default:
        this.recordBlocked(method)
        throw new Error(`method not allowed: ${method}`)
    }
  }

  private requireService(id: string): void {
    if (!this.perms.services.has(id)) {
      this.recordBlocked(`service:${id}`)
      throw new Error(`permission denied: service:${id}`)
    }
  }

  /** Per-widget storage scope — NUL can't appear in ids or keys, so no collision/escape. */
  private nsKey(key: string): string {
    return `${this.widgetId}\u0000${String(key)}`
  }

  private ensurePollForwarding(): void {
    if (this.offPoll) return
    this.offPoll = window.garret.poll.onUpdate((u: PollUpdate) => {
      if (this.pollKeys.has(u.key)) {
        this.send({ kind: 'event', channel: 'poll', payload: u })
      }
    })
  }

  private ensureWatchForwarding(): void {
    if (this.offWatch) return
    this.offWatch = window.garret.watch.onEvent((id: string) => {
      if (this.watchSubs.has(id)) this.send({ kind: 'event', channel: 'watch', payload: id })
    })
  }

  /** Send a config/refresh/teardown lifecycle message to the guest. */
  pushConfig(config: Record<string, unknown>): void {
    this.send({ kind: 'config', config })
  }
  pushRefresh(): void {
    this.send({ kind: 'refresh' })
  }
  init(instanceId: string, config: Record<string, unknown>, refreshToken: number): void {
    this.send({ kind: 'init', instanceId, config, refreshToken })
  }

  /** Unsubscribe everything the widget opened and stop forwarding. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    // Notify the guest, but never let a dead-webview send abort the rest of teardown
    // (the unsubscribes below MUST run, or poll/watch forwarding leaks).
    // Each step is best-effort and independently guarded: this runs inside a React effect
    // cleanup during unmount, so a throw here would escape past the (also-unmounting) error
    // boundary and blank the whole board. Nothing in teardown may throw.
    try {
      this.send({ kind: 'teardown' })
    } catch {
      /* guest already gone */
    }
    try {
      for (const subId of this.pollSubs.keys()) window.garret.poll.unsubscribe(this.nsKey(subId))
      for (const watchId of this.watchSubs) window.garret.watch.unsubscribe(watchId)
      this.offPoll?.()
      this.offWatch?.()
    } catch {
      /* renderer context tearing down — ignore */
    }
    this.pollSubs.clear()
    this.pollKeys.clear()
    this.watchSubs.clear()
  }
}
