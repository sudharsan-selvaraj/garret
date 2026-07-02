import { garretErrorFromWire, GarretError } from './errors'
import type { Transport } from './protocol'
import type { EventMap, HostClient, StreamCall } from './types'

/**
 * UI-side host client — a typed proxy over the wire (protocol.ts). Methods listed in `streams`
 * return a {@link StreamCall} synchronously; the rest return a Promise. Owns correlation ids,
 * the pending map, per-stream state (incl. a bounded pre-attach chunk buffer), and event demux.
 */
export interface HostClientOptions {
  /** Correlation namespace so two placements of a widget never cross wires. */
  instanceId: string
  /** Names of methods whose Api return type is `Stream<…>`. */
  streams?: readonly string[]
}

const MAX_PREATTACH_CHUNKS = 1000 // bound the buffer for chunks that arrive before .onData attaches

interface StreamState {
  onData: Array<(c: unknown) => void>
  onEnd: Array<(r: unknown) => void>
  onError: Array<(e: GarretError) => void>
  buffer: unknown[]
  overflow: boolean
  settled: boolean
  attached: boolean
  resultResolve?: (r: unknown) => void
  resultReject?: (e: unknown) => void
}

export type Client<Api, Events extends EventMap> = HostClient<Api> & {
  on<K extends keyof Events & string>(channel: K, cb: (payload: Events[K]) => void): () => void
  dispose(): void
}

export function createHostClient<Api, Events extends EventMap = EventMap>(
  transport: Transport,
  opts: HostClientOptions
): Client<Api, Events> {
  const streamMethods = new Set(opts.streams ?? [])
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  const streams = new Map<string, StreamState>()
  const events = new Map<string, Set<(p: unknown) => void>>()
  let seq = 0
  const nextId = (): string => `${opts.instanceId}:${++seq}`

  const off = transport.onMessage((msg) => {
    switch (msg.t) {
      case 'res': {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve(msg.result)
        }
        break
      }
      case 'err': {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.reject(garretErrorFromWire(msg.code, msg.message, msg.hint))
        }
        break
      }
      case 'chunk': {
        const s = streams.get(msg.id)
        if (!s) break
        if (s.onData.length) s.onData.forEach((cb) => cb(msg.data))
        else if (s.buffer.length < MAX_PREATTACH_CHUNKS) s.buffer.push(msg.data)
        else s.overflow = true
        break
      }
      case 'stream_end': {
        const s = streams.get(msg.id)
        if (!s) break
        s.settled = true
        s.onEnd.forEach((cb) => cb(msg.result))
        s.resultResolve?.(msg.result)
        streams.delete(msg.id)
        break
      }
      case 'stream_err': {
        const s = streams.get(msg.id)
        if (!s) break
        s.settled = true
        const e = garretErrorFromWire(msg.code, msg.message)
        s.onError.forEach((cb) => cb(e))
        s.resultReject?.(e)
        streams.delete(msg.id)
        break
      }
      case 'event': {
        events.get(msg.channel)?.forEach((cb) => cb(msg.payload))
        break
      }
    }
  })

  function makeStreamCall(method: string, args: unknown): StreamCall<unknown, unknown> {
    const id = nextId()
    const s: StreamState = {
      onData: [],
      onEnd: [],
      onError: [],
      buffer: [],
      overflow: false,
      settled: false,
      attached: false
    }
    streams.set(id, s)
    transport.send({ t: 'stream_start', id, method, args })
    // Auto-cancel a stream nobody consumes (prevents an unbounded buffer from a forgotten handle).
    queueMicrotask(() => {
      if (!s.attached && streams.has(id)) call.cancel()
    })
    const flushBuffer = (cb: (c: unknown) => void): void => {
      const buf = s.buffer
      s.buffer = []
      buf.forEach((c) => cb(c))
    }
    const call: StreamCall<unknown, unknown> = {
      onData(cb) {
        s.attached = true
        s.onData.push(cb)
        flushBuffer(cb)
        return call
      },
      onEnd(cb) {
        s.attached = true
        s.onEnd.push(cb)
        return call
      },
      onError(cb) {
        s.attached = true
        s.onError.push(cb)
        return call
      },
      cancel() {
        if (!streams.has(id)) return
        streams.delete(id)
        transport.send({ t: 'cancel', id })
      },
      result() {
        s.attached = true
        return new Promise((resolve, reject) => {
          s.resultResolve = resolve
          s.resultReject = reject
        })
      }
    }
    return call
  }

  function callMethod(method: string, args: unknown): Promise<unknown> {
    const id = nextId()
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      transport.send({ t: 'req', id, method, args })
    })
  }

  const base = {
    on(channel: string, cb: (p: unknown) => void): () => void {
      let set = events.get(channel)
      if (!set) events.set(channel, (set = new Set()))
      set.add(cb)
      return () => set!.delete(cb)
    },
    dispose(): void {
      off()
      pending.clear()
      streams.clear()
      events.clear()
    }
  }

  return new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop]
      // A method call: stream method → StreamCall (sync), else → Promise. Single-arg convention.
      return (args?: unknown) =>
        streamMethods.has(prop) ? makeStreamCall(prop, args) : callMethod(prop, args)
    }
  }) as unknown as Client<Api, Events>
}
