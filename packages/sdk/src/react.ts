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

/** Run `cb` when the host (frame ⋯→Settings) asks this widget to reveal its own config UI. */
export function useOpenSettings(cb: () => void): void {
  const g = getGarret()
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => g.onOpenSettings(() => ref.current()), [g])
}

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
