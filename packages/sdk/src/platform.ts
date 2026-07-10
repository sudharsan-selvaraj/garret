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
/** What `g.fetch` resolves to. NOT a DOM `Response` — a Response can't cross the contextBridge from
 *  the preload, so Garret hands back this serializable shape (primitive fields + body readers). */
export interface GarretResponse {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  arrayBuffer(): Promise<ArrayBuffer>
}
/** The pack-shared store (only usable when the pack manifest declares `shared`): one namespace across
 *  all the pack's widgets — e.g. a single credential set for a multi-widget service pack. */
export interface SharedApi {
  storage: StorageApi
  secrets: SecretsApi
}
/** Options for opening a floating sibling surface. All fields optional; sizes in px. */
export interface SurfaceOpenOptions {
  /** initial props delivered to the opened surface as `g.props`; structured-cloned, so each surface
   *  gets its own isolated copy (mutations are local). Must be structured-cloneable (no functions). */
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
/** Controls for the surface window THIS UI runs in (no-op for a board-placed widget). */
export interface WindowControls {
  /** Lock the window's aspect ratio (width/height); `0` clears it. Use once you know your content
   *  size — e.g. a mirror sets the device's ratio after the first video frame.
   *
   *  `inset` reserves guest-drawn chrome (px) that is EXCLUDED from the aspect-locked area, so the
   *  ratio applies to your content, not the whole window — e.g. a fixed 48px side toolbar passes
   *  `{ width: 48 }` and the remaining area keeps `ratio`. Combined with the host's own titlebar. */
  setAspectRatio(ratio: number, inset?: { width?: number; height?: number }): void
  /** Resize the window (px). */
  resize(width: number, height: number): void
  /** Close this surface window (for a frameless surface's own close button). */
  close(): void
}
export interface SurfaceApi {
  /** Open a sibling surface (declared in this package's manifest) as a floating, focusable window.
   *  Rejects with an Error (message from Garret) if denied — e.g. missing `windows` capability,
   *  unknown surface, or the concurrent-window limit. */
  open(surfaceId: string, opts?: SurfaceOpenOptions): Promise<SurfaceHandle>
  /** Observe closes of this opener's surfaces by instanceId. Unlike a handle's `onClose`/`closed()`
   *  (scoped to the current context), this SURVIVES an opener reload — re-subscribe on mount for
   *  reload-durable close tracking. */
  onClosed(cb: (instanceId: string) => void): () => void
}
export interface GarretPlatform {
  /** per-extension (shared across placements), atomic + key-merged. */
  storage: StorageApi
  /** per-placement (isolated) — safe for cursors/state that mustn't clobber other instances. */
  instanceStorage: StorageApi
  secrets: SecretsApi
  /** Brokered HTTPS fetch (capability `network:<host>` / `network:*`). Resolves to a GarretResponse
   *  (a Response-like shape — see the type), not a DOM Response. */
  fetch(url: string, init?: RequestInit): Promise<GarretResponse>
  /** Pack-shared store — present only when the pack declares `shared`; otherwise its calls reject. */
  shared: SharedApi
  service<T extends ServiceClient = ServiceClient>(id: string): T
  notify(title: string, body?: string): void
  openExternal(url: string): Promise<boolean>
  clipboard: { readText(): Promise<string>; writeText(value: string): Promise<void> }
  /** false when the board is ambient/idle — pause rAF/animations, throttle polling. */
  active: boolean
  onActiveChange(cb: (active: boolean) => void): () => void
  /** The host (frame ⋯→Settings) asks this widget to open its own config UI. */
  onOpenSettings(cb: () => void): () => void
  /** The host (frame ⋯→Refresh) asks this widget to reload its data. */
  onRefresh(cb: () => void): () => void
  /** Set this placement's title in the board frame header (persisted in the board config). */
  setTitle(title: string): void
  /** Open sibling surfaces (same package) as floating windows. Requires the `windows` capability. */
  surfaces: SurfaceApi
  /** Controls for this UI's own surface window (no-op for a board-placed widget). */
  window: WindowControls
  /** Fires once the runtime has bound, with this surface's launch props (`{}` for the board surface).
   *  Fires immediately if already ready. Props arrive via the callback — NOT a live getter — because
   *  a getter would be frozen at contextBridge exposure time (before bind). Use `useProps()` in React. */
  onReady(cb: (props: Record<string, unknown>) => void): () => void
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
    shared: { storage: stubStorage, secrets: stubSecrets },
    fetch: async () => {
      throw new GarretError('UNAVAILABLE', 'g.fetch is only available inside Garret')
    },
    service: <T extends ServiceClient = ServiceClient>(): T =>
      ({ status: nope, query: nope }) as unknown as T,
    notify: () => {},
    openExternal: async () => false,
    clipboard: { readText: nope, writeText: nope },
    active: true,
    onActiveChange: () => () => {},
    onOpenSettings: () => () => {},
    onRefresh: () => () => {},
    setTitle: () => {},
    surfaces: { open: nope, onClosed: () => () => {} },
    window: { setAspectRatio: () => {}, resize: () => {}, close: () => {} },
    onReady: (cb: (props: Record<string, unknown>) => void) => {
      cb({})
      return () => {}
    }
  }
}
