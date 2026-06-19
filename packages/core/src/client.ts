import type { PollUpdate } from './poll'
import type { WatchOptions } from './watch'

/** Per-widget persistent key/value storage. Shared by GarretClient + WidgetContext. */
export interface StorageApi {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

/** Connection status of a backend service (Jira, Bitbucket, Google, …). */
export interface ServiceStatus {
  connected: boolean
  /** Display name / email of the connected account, when connected. */
  account?: string
  /** Error message, when a connect attempt or status check failed. */
  error?: string
}

/**
 * The single capability surface a widget realm talks to the host through. Every
 * method is async + serializable so the SAME interface works whether the transport
 * is a direct in-process call (native: `window.garret.*`) or a postMessage
 * round-trip to the host (sandboxed widgets). The host runs all privileged work —
 * credentials and HTTP live there; results come back, secrets never cross.
 *
 * `createSDK(React, client)` binds the hook logic to a realm's React + this client,
 * so the hooks themselves are never duplicated between native and sandboxed widgets.
 */
export interface GarretClient {
  services: {
    status(id: string): Promise<ServiceStatus>
    connect(id: string, creds: Record<string, unknown>): Promise<ServiceStatus>
    disconnect(id: string): Promise<ServiceStatus>
    query<T = unknown>(id: string, method: string, params: Record<string, unknown>): Promise<T>
  }
  poll: {
    subscribe(
      subId: string,
      key: string,
      serviceId: string,
      method: string,
      params: Record<string, unknown>,
      intervalMs: number
    ): Promise<PollUpdate>
    unsubscribe(subId: string): void
    refresh(key: string): void
    onUpdate(cb: (u: PollUpdate) => void): () => void
  }
  watch: {
    subscribe(watchId: string, paths: string[], opts: WatchOptions): void
    unsubscribe(watchId: string): void
    onEvent(cb: (watchId: string) => void): () => void
  }
  /**
   * Host-mediated HTTP — runs in the host (no CORS), so it's the single network
   * chokepoint a sandbox can gate against a widget's declared `network:` permissions.
   */
  fetch(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>
  /**
   * Per-widget persistent key/value storage. Each widget realm gets its own client,
   * so this is naturally scoped to the widget (the host namespaces it) — widgets can't
   * read each other's data.
   */
  storage: StorageApi
  openExternal(url: string): void
}
