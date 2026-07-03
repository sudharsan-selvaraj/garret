import { defineHost } from '@garretapp/sdk/host'
import type { AdbServerClient } from '@yume-chan/adb'
import type { Api, Events, AdbDevice, AdbStatus, MirrorConfig } from '../shared/api'
import { getClient, ensureServer } from './adb/connection'
import { startTracker } from './adb/tracker'
import { openMirror } from './adb/mirror'
import { createHub, type MirrorHub } from './adb/session'

// One host is forked per placed surface: a LIST surface calls status()/listDevices() (→ the tracker);
// a MIRROR surface calls mirror()/audio() (→ one scrcpy session hub). Both start LAZILY, so a mirror
// window never opens a track socket and a list window never opens a scrcpy session.
export default defineHost<Api, Events>((ctx) => {
  // ── device list (event-driven tracker) ─────────────────────────────────────────────────────────
  let observer: AdbServerClient.DeviceObserver | null = null
  let current: AdbDevice[] = []
  let status: AdbStatus = { ok: false, state: 'connecting' }
  let tracking: Promise<void> | null = null

  const setStatus = (s: AdbStatus): void => {
    status = s
    ctx.emit('adb:status', s)
  }
  const runTracker = async (): Promise<void> => {
    await observer?.stop()
    observer = null
    current = []
    setStatus({ ok: false, state: 'connecting' })
    const r = await ensureServer(ctx)
    if (!r.ok) return setStatus({ ok: false, state: 'no-adb', error: r.error })
    try {
      observer = await startTracker(getClient(), (devices) => {
        current = devices
        ctx.emit('devices:changed', devices)
      })
      observer.onError((e) => setStatus({ ok: false, state: 'error', error: e.message }))
      setStatus({ ok: true, state: 'connected' })
    } catch (e) {
      setStatus({ ok: false, state: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }
  const ensureTracking = (): Promise<void> => (tracking ??= runTracker().finally(() => (tracking = null)))

  // ── mirror (one scrcpy session hub per host; drains both media streams regardless of subscription,
  //    ref-counted so it closes + resets on the last unsubscribe or on open failure) ───────────────
  let hub: MirrorHub | null = null
  let hubSerial: string | null = null
  let closingHub: Promise<void> | null = null // in-flight teardown; a re-open must serialize on it
  const getHub = (serial: string, cfg: MirrorConfig): MirrorHub => {
    // One host is forked per surface, so serial is stable — but guard anyway so a stray mismatched
    // call can't silently piggyback on (and mirror) the wrong device.
    if (hub && hubSerial !== serial) {
      closingHub = hub.close()
      hub = null
      hubSerial = null
    }
    if (hub) return hub
    hubSerial = serial
    const prevClose = closingHub // teardown of a previous session for this host, if any
    return (hub = createHub(
      async () => {
        // Don't overlap a fresh scrcpy session with a still-closing one (two app_process servers +
        // display contention). onEmpty's close() is async; wait it out before re-opening.
        await prevClose?.catch(() => {})
        const r = await ensureServer(ctx)
        if (!r.ok) throw new Error(r.error)
        return openMirror(getClient(), serial, cfg)
      },
      () => {
        const dead = hub
        hub = null // reset so a later subscribe re-opens a fresh session
        hubSerial = null
        closingHub = dead ? dead.close() : null // record teardown so the re-open serializes on it
        void closingHub
      }
    ))
  }

  ctx.onDispose(async () => {
    await observer?.stop()
    await hub?.close()
  })

  return {
    status: async () => {
      void ensureTracking()
      return status
    },
    listDevices: async () => {
      void ensureTracking()
      return current
    },
    retry: async () => {
      tracking = null
      return ensureTracking()
    },
    mirror: ({ serial, ...cfg }) =>
      ctx.stream((out, signal) => {
        const off = getHub(serial, cfg).subscribeVideo({
          push: (c) => out.push(c),
          end: () => out.end(),
          error: (e) => out.error(e)
        })
        signal.addEventListener('abort', off)
      }),
    audio: ({ serial }) =>
      ctx.stream((out, signal) => {
        const off = getHub(serial, {}).subscribeAudio({
          push: (c) => out.push(c),
          end: () => out.end(),
          error: (e) => out.error(e)
        })
        signal.addEventListener('abort', off)
      })
  }
})
