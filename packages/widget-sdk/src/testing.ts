import type { GarretClient, PollUpdate, ServiceStatus } from 'garret-core'

/**
 * Test/dev helpers for widget authors. Build a fake {@link GarretClient} so a widget
 * can be rendered and unit-tested WITHOUT a running Garret host — pass it to
 * `createSDK(React, createMockClient(...))`.
 *
 *   import { createSDK } from 'garret-widget-sdk'
 *   import { createMockClient } from 'garret-widget-sdk/testing'
 *   const sdk = createSDK(React, createMockClient({
 *     query: async (id, method) => method === 'listPRs' ? [{ id: 1, title: 'Test PR' }] : []
 *   }))
 */
export interface MockClientOptions {
  /** Resolve `services.query(serviceId, method, params)`. Defaults to `[]`. */
  query?: (serviceId: string, method: string, params: Record<string, unknown>) => Promise<unknown>
  /** Initial status returned by `services.status`. Defaults to connected. */
  status?: ServiceStatus
  /** Seed the result a poll subscription resolves with (and pushes via onUpdate). */
  pollResult?: (key: string) => Pick<PollUpdate, 'data' | 'error'>
  /** Resolve `fetch(url, init)`. Defaults to `{ ok: true, status: 200, data: null }`. */
  fetch?: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ) => Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>
  /** Seed initial per-widget storage. */
  storage?: Record<string, unknown>
  /** Called when the widget asks to open a URL (assert on it in tests). */
  onOpenExternal?: (url: string) => void
}

export interface MockClient extends GarretClient {
  /** Push a poll update to all subscribers of `key` (simulate a refresh landing). */
  emitPoll(update: PollUpdate): void
  /** Fire a file-watch event for `watchId`. */
  emitWatch(watchId: string): void
}

/** A no-op/canned GarretClient for tests and standalone dev. */
export function createMockClient(opts: MockClientOptions = {}): MockClient {
  const status: ServiceStatus = opts.status ?? { connected: true, account: 'mock@example.com' }
  const pollSubs = new Set<(u: PollUpdate) => void>()
  const watchSubs = new Set<(id: string) => void>()
  const store = new Map<string, unknown>(Object.entries(opts.storage ?? {}))
  let ts = 1

  return {
    services: {
      status: async () => status,
      connect: async () => status,
      disconnect: async () => ({ connected: false }),
      // A generic method (`query<T>(): Promise<T>`) can't be implemented with a
      // concrete return, so cast the impl to the declared signature.
      query: (async (id: string, method: string, params: Record<string, unknown>) =>
        opts.query ? opts.query(id, method, params) : []) as GarretClient['services']['query']
    },
    poll: {
      subscribe: async (_subId, key) => {
        const r = opts.pollResult?.(key) ?? { data: [] }
        return { key, data: r.data, error: r.error, ts: ts++ }
      },
      unsubscribe: () => {},
      refresh: () => {},
      onUpdate: (cb) => {
        pollSubs.add(cb)
        return () => pollSubs.delete(cb)
      }
    },
    watch: {
      subscribe: () => {},
      unsubscribe: () => {},
      onEvent: (cb) => {
        watchSubs.add(cb)
        return () => watchSubs.delete(cb)
      }
    },
    fetch: async (url, init) =>
      opts.fetch ? opts.fetch(url, init) : { ok: true, status: 200, data: null },
    storage: {
      get: async (key) => store.get(key) as never,
      set: async (key, value) => {
        store.set(key, value)
      }
    },
    openExternal: (url) => opts.onOpenExternal?.(url),
    emitPoll: (update) => pollSubs.forEach((cb) => cb(update)),
    emitWatch: (watchId) => watchSubs.forEach((cb) => cb(watchId))
  }
}
