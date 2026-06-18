import type { GarretClient } from './client'
import type { WatchOptions } from './watch'

/** Result of a live, auto-refreshing query (see GarretSDK.usePolledQuery). */
export interface PolledState<T> {
  data: T | undefined
  error: string | undefined
  loading: boolean
  /** Epoch ms of last successful fetch (0 = never). */
  ts: number
  refresh: () => void
}

/** A service's connection status + a setter (see GarretSDK.useServiceStatus). */
export interface ServiceStatusState {
  status: import('./client').ServiceStatus | null
  refresh: () => void
  setStatus: (s: import('./client').ServiceStatus) => void
}

/**
 * The SDK surface a widget renders against — hooks bound to a realm's React +
 * GarretClient by `createSDK`. Typed here in core (not widget-sdk) so the host and
 * widget realms, and `WidgetRenderProps.sdk`, can all reference one shape without a
 * dependency on the React-bound implementation.
 */
export interface GarretSDK {
  usePolledQuery<T = unknown>(
    serviceId: string,
    method: string,
    params: Record<string, unknown>,
    opts?: { intervalMs?: number; refreshToken?: number }
  ): PolledState<T>
  useServiceStatus(serviceId: string): ServiceStatusState
  useFileWatch(paths: string | string[], opts?: WatchOptions): number
  /** Connect / disconnect / status / query a backend service. */
  services: GarretClient['services']
  /** Host-mediated HTTP (no CORS); the network capability chokepoint. */
  fetch: GarretClient['fetch']
  /** Per-widget persistent key/value storage. */
  storage: GarretClient['storage']
  openExternal(url: string): void
  field: typeof import('./fields')['field']
  canonicalKey: typeof import('./key')['canonicalKey']
}
