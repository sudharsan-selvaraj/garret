import { defineHost } from '@garretapp/sdk/host'
import type { AdbServerClient } from '@yume-chan/adb'
import type { Api, Events, AdbDevice, AdbStatus } from '../shared/api'
import { getClient, ensureServer } from './adb/connection'
import { startTracker } from './adb/tracker'
import { openMirror, toVideoChunk, toAudioChunk, type MirrorSession } from './adb/mirror'

// One host is forked per placed surface: a LIST surface calls status()/listDevices() (→ the tracker);
// a MIRROR surface calls mirror()/audio() (→ one scrcpy session). Both are started LAZILY so a mirror
// window never opens a track socket and vice-versa.
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

  // ── mirror (one scrcpy session per host, opened on first mirror()/audio() subscribe) ────────────
  let session: Promise<MirrorSession> | null = null
  const getSession = (serial: string, cfg: { videoBitRate?: number; maxFps?: number; maxSize?: number }): Promise<MirrorSession> =>
    (session ??= (async () => {
      const r = await ensureServer(ctx)
      if (!r.ok) throw new Error(r.error)
      return openMirror(getClient(), serial, cfg)
    })())

  ctx.onDispose(async () => {
    await observer?.stop()
    if (session) {
      try {
        await (await session).close()
      } catch {
        /* already gone */
      }
    }
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
    // Video/audio start the session on subscribe and stop reading on cancel (signal); the session
    // itself is torn down on host dispose (the mirror window closing).
    mirror: ({ serial, ...cfg }) =>
      ctx.stream(async (out, signal) => {
        const s = await getSession(serial, cfg)
        out.push({ kind: 'meta', ...s.meta })
        const reader = s.video.getReader()
        signal.addEventListener('abort', () => void reader.cancel())
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          out.push(toVideoChunk(value))
        }
        out.end()
      }),
    audio: ({ serial }) =>
      ctx.stream(async (out, signal) => {
        const s = await getSession(serial, {})
        if (!s.audio) return out.end() // Android <11: no audio stream
        const reader = s.audio.getReader()
        signal.addEventListener('abort', () => void reader.cancel())
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          out.push(toAudioChunk(value))
        }
        out.end()
      })
  }
})
