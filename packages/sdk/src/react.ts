/** `@garret/sdk/react` — React hooks over the UI client + platform. All auto-clean up on unmount. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createHostClient, type Client } from './client'
import { GarretError } from './errors'
import { getGarret, getHostTransport, getInstanceId, getRuntime, type GarretPlatform } from './platform'
import type { EventMap, HostClient, StreamCall } from './types'

// One widget UI is one realm → one host client, memoised at module scope.
let singleton: Client<unknown, EventMap> | undefined
function hostClient<Api, Events extends EventMap>(): Client<Api, Events> {
  if (!singleton) {
    const transport = getHostTransport()
    if (!transport) throw new GarretError('UNAVAILABLE', 'this extension has no host process')
    singleton = createHostClient<unknown, EventMap>(transport, { instanceId: getInstanceId() })
  }
  return singleton as unknown as Client<Api, Events>
}

/** Typed proxy of your host's methods. Stream-vs-Promise is inferred from each method's `Api` return
 *  type — nothing to configure. */
export function useHost<Api, Events extends EventMap = EventMap>(): HostClient<Api> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => hostClient<Api, Events>() as unknown as HostClient<Api>, [])
}

/** Platform capabilities (storage/secrets/fetch/service/notify/…). Available in both tiers. */
export function useGarret(): GarretPlatform {
  return getGarret()
}

/** Subscribe to a typed host event. `useHostEvent<Events, 'changed'>('changed', p => …)`. */
export function useHostEvent<E extends EventMap, K extends keyof E & string>(
  channel: K,
  handler: (payload: E[K]) => void,
  deps: unknown[] = []
): void {
  useEffect(() => {
    const off = hostClient<unknown, E>().on(channel, handler as (p: unknown) => void)
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, ...deps])
}

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error'
export interface UseStreamResult<Chunk, Result> {
  chunks: Chunk[]
  result: Result | undefined
  error: GarretError | undefined
  status: StreamStatus
  cancel: () => void
}

/** Consume a stream in React without manual effect+cleanup. `deps` auto-cancel + restart; pass
 *  `{ enabled: false }` to defer (e.g. until the user triggers a run). */
export function useStream<Chunk, Result = void>(
  factory: () => StreamCall<Chunk, Result>,
  deps: unknown[] = [],
  opts?: { enabled?: boolean }
): UseStreamResult<Chunk, Result> {
  const enabled = opts?.enabled ?? true
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [result, setResult] = useState<Result | undefined>(undefined)
  const [error, setError] = useState<GarretError | undefined>(undefined)
  const [status, setStatus] = useState<StreamStatus>('idle')
  const ref = useRef<StreamCall<Chunk, Result> | null>(null)

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }
    setChunks([])
    setResult(undefined)
    setError(undefined)
    setStatus('streaming')
    const call = factory()
    ref.current = call
    call
      .onData((c) => setChunks((xs) => [...xs, c]))
      .onEnd((r) => {
        setResult(r)
        setStatus('done')
      })
      .onError((e) => {
        setError(e)
        setStatus('error')
      })
    return () => call.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  const cancel = useCallback(() => ref.current?.cancel(), [])
  return { chunks, result, error, status, cancel }
}

/** This placement's settings. `patch` shallow-merges; `replace` overwrites. */
export function useConfig<T>(): [T, (patch: Partial<T>) => void, (value: T) => void] {
  const rt = getRuntime()
  const [cfg, setCfg] = useState<T>((rt?.config.get() as T) ?? ({} as T))
  useEffect(() => rt?.config.subscribe((c) => setCfg(c as T)), [rt])
  const patch = useCallback((p: Partial<T>) => rt?.config.set(p, false), [rt])
  const replace = useCallback((v: T) => rt?.config.set(v, true), [rt])
  return [cfg, patch, replace]
}

/** Board activity — `false` when ambient/idle. Gate polling / rAF / animations on it. */
export function useActive(): boolean {
  const g = getGarret()
  const [active, setActive] = useState(g.active)
  useEffect(() => g.onActiveChange(setActive), [g])
  return active
}

/** Declarative frame ⋯-menu: pass items with inline handlers. Registers them with the host (id +
 *  label) and runs the matching `run` when the user picks one. One generic mechanism — no bespoke
 *  per-action hooks. Example: `useWidgetMenu([{ id: 'refresh', label: 'Refresh', run: reload }])`. */
export function useWidgetMenu(items: { id: string; label: string; run: () => void }[]): void {
  const g = getGarret()
  const ref = useRef(items)
  ref.current = items
  const key = items.map((i) => `${i.id}:${i.label}`).join('|')
  useEffect(() => {
    g.setCommands(ref.current.map((i) => ({ id: i.id, label: i.label })))
    return g.onCommand((id) => ref.current.find((i) => i.id === id)?.run())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, key])
}

/** Per-placement config backed by `g.instanceStorage` (isolated per widget instance). Loads once the
 *  runtime binds (calls before bind reject); `set` writes through to storage + state. `loaded` gates
 *  the first data fetch so you don't fetch with defaults before the saved config arrives. */
export function useInstanceConfig<T extends Record<string, unknown>>(
  defaults: T
): { cfg: T; set: (patch: Partial<T>) => void; loaded: boolean } {
  const g = getGarret()
  const [cfg, setCfg] = useState<T>(defaults)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    const unsub = g.onReady(() => {
      void (async () => {
        const saved: Record<string, unknown> = {}
        await Promise.all(
          Object.keys(defaults).map(async (k) => {
            const v = await g.instanceStorage.get(k)
            if (v !== undefined) saved[k] = v
          })
        )
        if (alive) {
          setCfg({ ...defaults, ...saved })
          setLoaded(true)
        }
      })()
    })
    return () => {
      alive = false
      unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const set = useCallback(
    (patch: Partial<T>) => {
      setCfg((c) => ({ ...c, ...patch }))
      for (const [k, v] of Object.entries(patch)) void g.instanceStorage.set(k, v as unknown)
    },
    [g]
  )
  return { cfg, set, loaded }
}

// Native UI components (theme-styled markup) — SettingsPanel, StatusPill, TicketRow, etc.
export * from './components'

/** Launch props for a spawned surface window (`g.surfaces.open(..., { props })`). `{}` for the board
 *  surface. Delivered via `onReady`'s callback (a contextBridge getter would be frozen at exposure
 *  time), so this re-renders when the runtime binds. The `T` is an unchecked cast — validate it yourself. */
export function useProps<T = Record<string, unknown>>(): T {
  const g = getGarret()
  const [props, setProps] = useState<Record<string, unknown>>({})
  useEffect(() => g.onReady((p) => setProps(p)), [g])
  return props as T
}

export { GarretError } from './errors'
export type { GarretPlatform, SurfaceApi, SurfaceHandle, SurfaceOpenOptions, WindowControls } from './platform'
