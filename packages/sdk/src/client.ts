import { garretErrorFromWire, GarretError } from './errors'
import type { Transport } from './protocol'
import type { EventMap, HostClient } from './types'

/**
 * UI-side host client — a typed proxy over the wire (protocol.ts). Every call returns ONE handle
 * that is both a Promise (plain methods `await` it) and a stream sink (stream methods use
 * `.onData/.onEnd`). The `HostClient<Api>` TYPE narrows it per method from the `Api` return type —
 * so authors never restate which methods stream. The host decides stream-vs-value from the runtime
 * return; the client handles either response on the same id.
 */
export interface HostClientOptions {
  /** Correlation namespace so two placements of a widget never cross wires. */
  instanceId: string
}

const MAX_PREATTACH_CHUNKS = 1000 // bound chunks buffered before .onData attaches
const IDLE_TIMEOUT_MS = 30_000 // reject a call idle this long (dead/absent host); reset by each chunk

interface CallState {
  onData: Array<(c: unknown) => void>
  onEnd: Array<(r: unknown) => void>
  onError: Array<(e: GarretError) => void>
  buffer: unknown[]
  overflow: boolean
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

export type Client<Api, Events extends EventMap> = HostClient<Api> & {
  on<K extends keyof Events & string>(channel: K, cb: (payload: Events[K]) => void): () => void
  dispose(): void
}

export function createHostClient<Api, Events extends EventMap = EventMap>(
  transport: Transport,
  opts: HostClientOptions
): Client<Api, Events> {
  const calls = new Map<string, CallState>()
  const events = new Map<string, Set<(p: unknown) => void>>()
  const eventBuffer = new Map<string, unknown[]>()
  let seq = 0
  const nextId = (): string => `${opts.instanceId}:${++seq}`

  const settle = (id: string, fn: (s: CallState) => void): void => {
    const s = calls.get(id)
    if (!s) return
    clearTimeout(s.timer)
    calls.delete(id)
    fn(s)
  }
  const timeoutError = (method: string): GarretError => new GarretError('TIMEOUT', `"${method}" timed out`)

  const off = transport.onMessage((msg) => {
    switch (msg.t) {
      case 'res':
        settle(msg.id, (s) => s.resolve(msg.result))
        break
      case 'stream_end':
        settle(msg.id, (s) => {
          s.onEnd.forEach((cb) => cb(msg.result))
          s.resolve(msg.result)
        })
        break
      case 'err':
        settle(msg.id, (s) => {
          const e = garretErrorFromWire(msg.code, msg.message, msg.hint)
          s.onError.forEach((cb) => cb(e))
          s.reject(e)
        })
        break
      case 'stream_err':
        settle(msg.id, (s) => {
          const e = garretErrorFromWire(msg.code, msg.message)
          s.onError.forEach((cb) => cb(e))
          s.reject(e)
        })
        break
      case 'chunk': {
        const s = calls.get(msg.id)
        if (!s) break
        clearTimeout(s.timer) // activity → the stream is alive; re-arm the idle timer
        s.timer = setTimeout(() => settle(msg.id, (st) => st.reject(timeoutError(msg.id))), IDLE_TIMEOUT_MS)
        if (s.onData.length) s.onData.forEach((cb) => cb(msg.data))
        else if (s.buffer.length < MAX_PREATTACH_CHUNKS) s.buffer.push(msg.data)
        else s.overflow = true
        break
      }
      case 'event': {
        const subs = events.get(msg.channel)
        if (subs && subs.size) subs.forEach((cb) => cb(msg.payload))
        else {
          const buf = eventBuffer.get(msg.channel) ?? []
          if (buf.length < 100) buf.push(msg.payload)
          eventBuffer.set(msg.channel, buf)
        }
        break
      }
    }
  })

  function makeCall(method: string, args: unknown): unknown {
    const id = nextId()
    let resolve!: (v: unknown) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res
      reject = rej
    })
    promise.catch(() => {}) // no unhandledrejection when the author only uses .onError
    const s: CallState = {
      onData: [],
      onEnd: [],
      onError: [],
      buffer: [],
      overflow: false,
      resolve,
      reject,
      timer: setTimeout(() => {
        const e = timeoutError(method)
        settle(id, (st) => {
          st.onError.forEach((cb) => cb(e))
          st.reject(e)
        })
      }, IDLE_TIMEOUT_MS)
    }
    calls.set(id, s)
    transport.send({ t: 'req', id, method, args })

    const flush = (cb: (c: unknown) => void): void => {
      const buf = s.buffer
      s.buffer = []
      buf.forEach((c) => cb(c))
    }
    // One object, both shapes. HostClient<Api> exposes only the half the method's type allows.
    const call = {
      then: (onF?: ((v: unknown) => unknown) | null, onR?: ((e: unknown) => unknown) | null) => promise.then(onF, onR),
      catch: (onR?: ((e: unknown) => unknown) | null) => promise.catch(onR),
      finally: (cb?: (() => void) | null) => promise.finally(cb),
      result: () => promise,
      onData(cb: (c: unknown) => void) {
        s.onData.push(cb)
        flush(cb)
        return call
      },
      onEnd(cb: (r: unknown) => void) {
        s.onEnd.push(cb)
        return call
      },
      onError(cb: (e: GarretError) => void) {
        s.onError.push(cb)
        return call
      },
      cancel() {
        if (!calls.has(id)) return
        clearTimeout(s.timer)
        calls.delete(id)
        transport.send({ t: 'cancel', id })
      }
    }
    return call
  }

  const base = {
    on(channel: string, cb: (p: unknown) => void): () => void {
      let set = events.get(channel)
      if (!set) events.set(channel, (set = new Set()))
      set.add(cb)
      const buffered = eventBuffer.get(channel) // replay events emitted before this first subscriber
      if (buffered?.length) {
        eventBuffer.delete(channel)
        buffered.forEach((p) => cb(p))
      }
      return () => set!.delete(cb)
    },
    dispose(): void {
      off()
      for (const s of calls.values()) clearTimeout(s.timer)
      calls.clear()
      events.clear()
      eventBuffer.clear()
    }
  }

  return new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop]
      return (args?: unknown) => makeCall(prop, args) // single-arg convention
    }
  }) as unknown as Client<Api, Events>
}
