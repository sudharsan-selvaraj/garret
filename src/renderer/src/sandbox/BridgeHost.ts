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
  private readonly watchSubs = new Set<string>()
  private readonly used = new Set<string>() // capabilities actually exercised (disclosure)
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

  /** Capabilities the widget actually invoked — feeds the Phase-4 disclosure diff. */
  usedCapabilities(): string[] {
    return [...this.used]
  }

  /** Handle a message from the guest. Never throws. */
  handle(msg: GuestMessage): void {
    if (this.disposed) return
    if (msg.kind === 'ready') return this.onReady()
    if (msg.kind === 'updateConfig') {
      return this.onUpdateConfig(msg.patch && typeof msg.patch === 'object' ? msg.patch : {})
    }
    if (msg.kind !== 'call') return
    // Size guard before any work.
    if (JSON.stringify(msg).length > MAX_MSG_BYTES) {
      if (msg.id) this.send({ kind: 'error', id: msg.id, message: 'message too large' })
      return
    }
    if (!this.takeToken()) {
      if (msg.id) this.send({ kind: 'error', id: msg.id, message: 'rate limited' })
      return
    }
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
    this.used.add(method)
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
        this.ensurePollForwarding()
        return g.poll.subscribe(subId, key, serviceId, m, params, intervalMs)
      }
      case 'poll.unsubscribe': {
        const [subId] = args as [string]
        if (this.pollSubs.has(subId)) {
          this.pollSubs.delete(subId)
          g.poll.unsubscribe(subId)
        }
        return undefined
      }
      case 'poll.refresh': {
        const [key] = args as [string]
        if ([...this.pollSubs.values()].includes(key)) g.poll.refresh(key)
        return undefined
      }
      case 'watch.subscribe': {
        const [watchId, paths, opts] = args as [string, string[], Record<string, unknown>]
        if (!this.perms.files) throw new Error('permission denied: files:read')
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
        const [url, init] = args as [string, Record<string, unknown> | undefined]
        // Renderer layer: scope to the widget's OWN declared hosts; main re-checks
        // host + resolved IP. No network perms ⇒ empty list ⇒ main denies everything.
        return g.plugins.fetch(url, init as never, { allowedHosts: this.perms.networkHosts })
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
        if (!this.perms.openExternal) throw new Error('permission denied: openExternal')
        return g.plugins.openExternalConfirmed(url)
      }
      default:
        throw new Error(`method not allowed: ${method}`)
    }
  }

  private requireService(id: string): void {
    if (!this.perms.services.has(id)) throw new Error(`permission denied: service:${id}`)
  }

  /** Per-widget storage scope — NUL can't appear in ids or keys, so no collision/escape. */
  private nsKey(key: string): string {
    return `${this.widgetId}\u0000${String(key)}`
  }

  private ensurePollForwarding(): void {
    if (this.offPoll) return
    this.offPoll = window.garret.poll.onUpdate((u: PollUpdate) => {
      if ([...this.pollSubs.values()].includes(u.key)) {
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
    this.send({ kind: 'teardown' })
    for (const subId of this.pollSubs.keys()) window.garret.poll.unsubscribe(subId)
    for (const watchId of this.watchSubs) window.garret.watch.unsubscribe(watchId)
    this.pollSubs.clear()
    this.watchSubs.clear()
    this.offPoll?.()
    this.offWatch?.()
  }
}

export { parsePermissions }
