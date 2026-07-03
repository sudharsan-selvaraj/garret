import { GarretError } from './errors'
import type { Transport } from './protocol'

/**
 * Platform capabilities — the Garret-brokered surface available to a widget UI in BOTH tiers
 * (`useGarret()`). Every call is enforced in Garret's main process against the manifest's declared
 * capabilities. The concrete implementation is injected by the preload as `window.__garret` (U3);
 * outside Garret (dev in a browser) a fallback reports `inGarret === false` and throws on use.
 */
export interface ServiceStatus {
  connected: boolean
}
export interface ServiceClient {
  /** Connection state is async (the account is connected in Garret's Settings, brokered by main). */
  status(): Promise<ServiceStatus>
  query<R = unknown>(method: string, params?: Record<string, unknown>): Promise<R>
}
export interface StorageApi {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
  clear(): Promise<void>
}
export interface SecretsApi {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}
/** Options for opening a floating sibling surface. All fields optional; sizes in px. */
export interface SurfaceOpenOptions {
  /** initial, immutable props delivered to the opened surface as `g.props`. */
  props?: Record<string, unknown>
  title?: string
  size?: { w: number; h: number }
  /** default true — the window stays above normal windows while you work. */
  alwaysOnTop?: boolean
  /** singleton: a repeat open with the same key focuses the existing window instead of spawning. */
  key?: string
}
/** A handle to a floating surface window opened via `g.surfaces.open`. */
export interface SurfaceHandle {
  readonly id: string
  close(): Promise<boolean>
  focus(): Promise<boolean>
  /** Resolves when the window closes — by the user, `close()`, or its opener being removed. */
  closed(): Promise<void>
  onClose(cb: () => void): () => void
}
export interface SurfaceApi {
  /** Open a sibling surface (declared in this package's manifest) as a floating, focusable window. */
  open(surfaceId: string, opts?: SurfaceOpenOptions): Promise<SurfaceHandle>
}
export interface GarretPlatform {
  /** per-extension (shared across placements), atomic + key-merged. */
  storage: StorageApi
  /** per-placement (isolated) — safe for cursors/state that mustn't clobber other instances. */
  instanceStorage: StorageApi
  secrets: SecretsApi
  fetch: typeof fetch
  service<T extends ServiceClient = ServiceClient>(id: string): T
  notify(title: string, body?: string): void
  openExternal(url: string): Promise<boolean>
  clipboard: { readText(): Promise<string>; writeText(value: string): Promise<void> }
  /** false when the board is ambient/idle — pause rAF/animations, throttle polling. */
  active: boolean
  onActiveChange(cb: (active: boolean) => void): () => void
  /** Open sibling surfaces (same package) as floating windows. Requires the `windows` capability. */
  surfaces: SurfaceApi
  /** Launch props for a spawned surface; `{}` for the board/primary surface. Available after `onReady`. */
  props: Record<string, unknown>
  /** Fires once the runtime has bound (so `props` are populated); fires immediately if already ready. */
  onReady(cb: () => void): () => void
  /** false in a plain browser (dev) — render a "run inside Garret" state instead of a blank UI. */
  inGarret: boolean
}

/** What the preload injects. Extends the platform with the wiring the SDK runtimes need. */
export interface GarretRuntime extends GarretPlatform {
  instanceId: string
  /** the per-widget host bridge; null for web widgets (no host). */
  hostTransport: Transport | null
  config: {
    get(): unknown
    /** replace=false → shallow merge (patch); true → full replace. */
    set(value: unknown, replace?: boolean): void
    subscribe(cb: (config: unknown) => void): () => void
  }
}

declare global {
  // eslint-disable-next-line no-var
  interface Window {
    __garret?: GarretRuntime
  }
}

export function getRuntime(): GarretRuntime | undefined {
  return typeof window !== 'undefined' ? window.__garret : undefined
}
export function getHostTransport(): Transport | null {
  return getRuntime()?.hostTransport ?? null
}
export function getInstanceId(): string {
  return getRuntime()?.instanceId ?? 'dev'
}

function nope(): never {
  throw new GarretError('UNAVAILABLE', 'not running inside Garret')
}
const stubStorage: StorageApi = { get: nope, set: nope, delete: nope, keys: nope, clear: nope }
const stubSecrets: SecretsApi = { get: nope, set: nope, delete: nope }

/** The platform capabilities. Real inside Garret; a fail-loud fallback in a plain browser. */
export function getGarret(): GarretPlatform {
  const rt = getRuntime()
  if (rt) return rt
  return {
    inGarret: false,
    storage: stubStorage,
    instanceStorage: stubStorage,
    secrets: stubSecrets,
    fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
    service: <T extends ServiceClient = ServiceClient>(): T =>
      ({ status: nope, query: nope }) as unknown as T,
    notify: () => {},
    openExternal: async () => false,
    clipboard: { readText: nope, writeText: nope },
    active: true,
    onActiveChange: () => () => {},
    surfaces: { open: nope },
    props: {},
    onReady: (cb: () => void) => {
      cb()
      return () => {}
    }
  }
}
