import { defineHost } from '@garretapp/sdk/host'
import type { AdbServerClient } from '@yume-chan/adb'
import type { Api, Events, AdbDevice, AdbStatus } from '../shared/api'
import { getClient, ensureServer } from './adb/connection'
import { startTracker } from './adb/tracker'

// Thin controller: wires the adb connection + live tracker (host/adb/*) to the UI-facing API.
// ya-webadb is pure TS → bundles into this raw-Node host (no native .node addon).
export default defineHost<Api, Events>((ctx) => {
  let observer: AdbServerClient.DeviceObserver | null = null
  let current: AdbDevice[] = []
  let status: AdbStatus = { ok: false, state: 'connecting' }

  const setStatus = (s: AdbStatus): void => {
    status = s
    ctx.emit('adb:status', s)
  }

  const start = async (): Promise<void> => {
    await observer?.stop()
    observer = null
    setStatus({ ok: false, state: 'connecting' })
    const r = await ensureServer(ctx)
    if (!r.ok) return setStatus({ ok: false, state: 'no-adb', error: r.error })
    try {
      observer = await startTracker(getClient(), (devices) => {
        current = devices
        ctx.emit('devices:changed', devices)
      })
      setStatus({ ok: true, state: 'connected' })
    } catch (e) {
      setStatus({ ok: false, state: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  void start()
  ctx.onDispose(() => void observer?.stop())

  return {
    status: async () => status,
    listDevices: async () => current,
    retry: async () => start()
  }
})
