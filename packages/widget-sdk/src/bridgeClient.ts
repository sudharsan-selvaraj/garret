import type { BridgeTransport, GarretClient, HostMessage, PollUpdate } from 'garret-core'
import { uid } from './uid'

/**
 * A {@link GarretClient} that proxies every capability over the host bridge — the sandbox
 * realm's counterpart to the native `ipcClient`. Same interface, different transport, so
 * `createSDK(React, client)` is identical in both realms.
 *
 * Returns the client plus `accept(msg)`: the bootstrap feeds it host messages and it
 * consumes the ones it owns (`result`/`error`/`event`), leaving lifecycle messages
 * (`init`/`config`/`refresh`/`teardown`) for the bootstrap.
 */
export function createBridgeClient(transport: BridgeTransport): {
  client: GarretClient
  accept(msg: HostMessage): boolean
} {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const pollCbs = new Set<(u: PollUpdate) => void>()
  const watchCbs = new Set<(id: string) => void>()

  const call = <T>(method: string, args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = uid()
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      transport.post({ kind: 'call', id, method, args })
    })

  const fire = (method: string, args: unknown[]): void => {
    transport.post({ kind: 'call', method, args }) // no id → host won't reply
  }

  const client: GarretClient = {
    services: {
      status: (id) => call('services.status', [id]),
      connect: (id, creds) => call('services.connect', [id, creds]),
      disconnect: (id) => call('services.disconnect', [id]),
      query: ((id: string, method: string, params: Record<string, unknown>) =>
        call('services.query', [id, method, params])) as GarretClient['services']['query']
    },
    poll: {
      subscribe: (subId, key, serviceId, method, params, intervalMs) =>
        call('poll.subscribe', [subId, key, serviceId, method, params, intervalMs]),
      unsubscribe: (subId) => fire('poll.unsubscribe', [subId]),
      refresh: (key) => fire('poll.refresh', [key]),
      onUpdate: (cb) => {
        pollCbs.add(cb)
        return () => pollCbs.delete(cb)
      }
    },
    watch: {
      subscribe: (watchId, paths, opts) => fire('watch.subscribe', [watchId, paths, opts]),
      unsubscribe: (watchId) => fire('watch.unsubscribe', [watchId]),
      onEvent: (cb) => {
        watchCbs.add(cb)
        return () => watchCbs.delete(cb)
      }
    },
    fetch: (url, init) => call('fetch', [url, init]),
    storage: {
      get: ((key: string) => call('storage.get', [key])) as GarretClient['storage']['get'],
      set: (key, value) => call('storage.set', [key, value])
    },
    openExternal: (url) => fire('openExternal', [url])
  }

  const accept = (msg: HostMessage): boolean => {
    if (msg.kind === 'result') {
      pending.get(msg.id)?.resolve(msg.value)
      pending.delete(msg.id)
      return true
    }
    if (msg.kind === 'error') {
      pending.get(msg.id)?.reject(new Error(msg.message))
      pending.delete(msg.id)
      return true
    }
    if (msg.kind === 'event') {
      if (msg.channel === 'poll') pollCbs.forEach((cb) => cb(msg.payload as PollUpdate))
      else watchCbs.forEach((cb) => cb(msg.payload as string))
      return true
    }
    return false
  }

  return { client, accept }
}
