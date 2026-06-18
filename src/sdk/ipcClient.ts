import type { GarretClient } from 'garret-core'

/**
 * The native host realm's GarretClient — a thin passthrough to the preload bridge
 * (`window.garret.*`), which runs in the same realm. The sandboxed widget realm
 * will provide a different client (postMessage bridge) for the SAME interface, so
 * the SDK hooks built on top of it don't change.
 */
export const ipcClient: GarretClient = {
  services: {
    status: (id) => window.garret.services.status(id),
    connect: (id, creds) => window.garret.services.connect(id, creds),
    disconnect: (id) => window.garret.services.disconnect(id),
    query: (id, method, params) => window.garret.services.query(id, method, params)
  },
  poll: {
    subscribe: (subId, key, serviceId, method, params, intervalMs) =>
      window.garret.poll.subscribe(subId, key, serviceId, method, params, intervalMs),
    unsubscribe: (subId) => window.garret.poll.unsubscribe(subId),
    refresh: (key) => window.garret.poll.refresh(key),
    onUpdate: (cb) => window.garret.poll.onUpdate(cb)
  },
  watch: {
    subscribe: (watchId, paths, opts) => window.garret.watch.subscribe(watchId, paths, opts),
    unsubscribe: (watchId) => window.garret.watch.unsubscribe(watchId),
    onEvent: (cb) => window.garret.watch.onEvent(cb)
  },
  openExternal: (url) => window.garret.openExternal(url)
}
