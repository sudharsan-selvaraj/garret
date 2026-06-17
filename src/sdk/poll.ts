import { useEffect, useRef, useState } from 'react'
import { canonicalKey } from '@shared/poll/key'
import type { PollUpdate } from '@shared/types/poll'

const DEFAULT_INTERVAL = 5 * 60 * 1000

// One shared ipc listener fans out to hooks by key (avoids N listeners / MaxListeners).
type Listener = (u: PollUpdate) => void
const listeners = new Map<string, Set<Listener>>()
let wired = false
function ensureWired(): void {
  if (wired) return
  wired = true
  window.garret.poll.onUpdate((u) => listeners.get(u.key)?.forEach((l) => l(u)))
}

export interface PolledState<T> {
  data: T | undefined
  error: string | undefined
  loading: boolean
  /** Epoch ms of last successful fetch (0 = never). */
  ts: number
  refresh: () => void
}

/**
 * Subscribe a widget to a live, auto-refreshing query. Identical queries across
 * widgets are coalesced into one shared fetch in the main process. Pass
 * `ctx.refreshToken` to wire the widget's ↻ button to an immediate refresh.
 */
export function usePolledQuery<T = unknown>(
  serviceId: string,
  method: string,
  params: Record<string, unknown>,
  opts?: { intervalMs?: number; refreshToken?: number }
): PolledState<T> {
  const key = canonicalKey(serviceId, method, params)
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL
  const [state, setState] = useState<{ data?: T; error?: string; ts: number; loading: boolean }>({
    ts: 0,
    loading: true
  })

  // Latest values to send on (re)subscribe; the effect keys off the string `key`.
  const latest = useRef({ serviceId, method, params, intervalMs })
  latest.current = { serviceId, method, params, intervalMs }

  useEffect(() => {
    ensureWired()
    const subId = crypto.randomUUID()
    const onUpdate: Listener = (u) =>
      setState({ data: u.data as T, error: u.error, ts: u.ts, loading: false })

    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(onUpdate)
    setState((s) => ({ ...s, loading: true }))

    void window.garret.poll
      .subscribe(subId, key, latest.current.serviceId, latest.current.method, latest.current.params, latest.current.intervalMs)
      .then((cached) => {
        if (cached.ts > 0 || cached.error) {
          setState({ data: cached.data as T, error: cached.error, ts: cached.ts, loading: false })
        }
      })

    return () => {
      set?.delete(onUpdate)
      if (set && set.size === 0) listeners.delete(key)
      window.garret.poll.unsubscribe(subId)
    }
  }, [key, intervalMs])

  // Manual refresh (↻) wired through ctx.refreshToken.
  const refreshToken = opts?.refreshToken ?? 0
  useEffect(() => {
    if (refreshToken > 0) {
      setState((s) => ({ ...s, loading: true }))
      window.garret.poll.refresh(key)
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
      window.garret.poll.refresh(key)
    }
  }
}
