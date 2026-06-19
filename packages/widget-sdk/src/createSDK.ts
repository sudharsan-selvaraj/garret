import type * as ReactNS from 'react'
import {
  canonicalKey,
  field,
  type GarretClient,
  type GarretSDK,
  type PollUpdate
} from 'garret-core'
import { uid } from './uid'

/** The slice of React the hooks need. Injected per realm so hooks are never duplicated. */
export type ReactApi = Pick<typeof ReactNS, 'useState' | 'useEffect' | 'useRef' | 'useCallback'>

const DEFAULT_INTERVAL = 5 * 60 * 1000

/**
 * Bind the widget hook LOGIC to a realm's React + capability `client`. Native host
 * calls `createSDK(hostReact, ipcClient)`; a sandboxed widget bundle will call
 * `createSDK(widgetReact, bridgeClient)`. The bodies below are realm-agnostic —
 * only `React.*` and `client.*` differ — so nothing is duplicated across realms.
 *
 * Lifecycle: create ONE sdk per realm/widget-load (the host does this and injects it
 * as `WidgetRenderProps.sdk`). The poll fan-out below lives for the sdk's lifetime, so
 * the sandbox runtime must create a fresh sdk per iframe load, not reuse one across
 * mounts, or listeners accumulate.
 */
export function createSDK(React: ReactApi, client: GarretClient): GarretSDK {
  // One shared client listener fans out to hooks by key (avoids N listeners). Scoped
  // to this SDK instance so each realm has its own fan-out.
  type Listener = (u: PollUpdate) => void
  const listeners = new Map<string, Set<Listener>>()
  let wired = false
  const ensureWired = (): void => {
    if (wired) return
    wired = true
    client.poll.onUpdate((u) => listeners.get(u.key)?.forEach((l) => l(u)))
  }

  const usePolledQuery: GarretSDK['usePolledQuery'] = <T = unknown>(
    serviceId: string,
    method: string,
    params: Record<string, unknown>,
    opts?: { intervalMs?: number; refreshToken?: number }
  ) => {
    const key = canonicalKey(serviceId, method, params)
    const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL
    const [state, setState] = React.useState<{
      data?: T
      error?: string
      ts: number
      loading: boolean
    }>({ ts: 0, loading: true })

    // Latest values to send on (re)subscribe; the effect keys off the string `key`.
    const latest = React.useRef({ serviceId, method, params, intervalMs })
    latest.current = { serviceId, method, params, intervalMs }

    React.useEffect(() => {
      ensureWired()
      const subId = uid()
      const onUpdate: Listener = (u) =>
        setState({ data: u.data as T, error: u.error, ts: u.ts, loading: false })

      let set = listeners.get(key)
      if (!set) {
        set = new Set()
        listeners.set(key, set)
      }
      set.add(onUpdate)
      setState((s) => ({ ...s, loading: true }))

      void client.poll
        .subscribe(
          subId,
          key,
          latest.current.serviceId,
          latest.current.method,
          latest.current.params,
          latest.current.intervalMs
        )
        .then((cached) => {
          if (cached.ts > 0 || cached.error) {
            setState({ data: cached.data as T, error: cached.error, ts: cached.ts, loading: false })
          }
        })

      return () => {
        set?.delete(onUpdate)
        if (set && set.size === 0) listeners.delete(key)
        client.poll.unsubscribe(subId)
      }
    }, [key, intervalMs])

    // Manual refresh (↻) wired through ctx.refreshToken.
    const refreshToken = opts?.refreshToken ?? 0
    React.useEffect(() => {
      if (refreshToken > 0) {
        setState((s) => ({ ...s, loading: true }))
        client.poll.refresh(key)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshToken])

    return {
      data: state.data,
      error: state.error,
      loading: state.loading,
      ts: state.ts,
      refresh: () => {
        setState((s) => ({ ...s, loading: true }))
        client.poll.refresh(key)
      }
    }
  }

  const useServiceStatus: GarretSDK['useServiceStatus'] = (serviceId) => {
    const [status, setStatus] = React.useState<
      Awaited<ReturnType<GarretClient['services']['status']>> | null
    >(null)
    const refresh = React.useCallback(() => {
      void client.services.status(serviceId).then(setStatus)
    }, [serviceId])
    React.useEffect(refresh, [refresh])
    return { status, refresh, setStatus }
  }

  const useFileWatch: GarretSDK['useFileWatch'] = (paths, opts) => {
    const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean)
    const dep = JSON.stringify([list, opts])
    const [version, setVersion] = React.useState(0)

    React.useEffect(() => {
      if (list.length === 0) return
      const watchId = uid()
      const off = client.watch.onEvent((id) => {
        if (id === watchId) setVersion((v) => v + 1)
      })
      client.watch.subscribe(watchId, list, opts ?? {})
      return () => {
        off()
        client.watch.unsubscribe(watchId)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dep])

    return version
  }

  return {
    usePolledQuery,
    useServiceStatus,
    useFileWatch,
    services: client.services,
    fetch: client.fetch,
    storage: client.storage,
    openExternal: (url: string) => client.openExternal(url),
    field,
    canonicalKey
  }
}
