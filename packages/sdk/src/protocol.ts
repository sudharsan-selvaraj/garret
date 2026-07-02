/**
 * The Garret wire protocol — the one envelope every widget call/event/stream rides on, across
 * both hops (UI ⇄ main, main ⇄ host). Locked before the SDK: `defineHost`/`useHost`/`ctx.stream`
 * are thin wrappers over this. Structured-clone only (Date/Map/Uint8Array survive; no functions).
 * See docs/architecture.md §2.
 */

/** A correlation id, namespaced `${instanceId}:${seq}` so two placements never collide. */
export type CallId = string

export type WireMessage =
  // ── request / response ──────────────────────────────────────────────
  | { t: 'req'; id: CallId; method: string; args: unknown }
  | { t: 'res'; id: CallId; result: unknown }
  | { t: 'err'; id: CallId; code: string; message: string; hint?: string }
  // ── streaming ───────────────────────────────────────────────────────
  | { t: 'stream_start'; id: CallId; method: string; args: unknown } // UI → host (stream methods)
  | { t: 'chunk'; id: CallId; data: unknown } // host → UI (0..n)
  | { t: 'stream_end'; id: CallId; result: unknown } // host → UI (once)
  | { t: 'stream_err'; id: CallId; code: string; message: string }
  | { t: 'cancel'; id: CallId } // UI → host: abort the signal + kill children
  // ── events (unsolicited, host → UI) ─────────────────────────────────
  | { t: 'event'; channel: string; payload: unknown }
  // ── lifecycle ───────────────────────────────────────────────────────
  | { t: 'ready' } // host → main: init complete, accept requests
  | { t: 'dispose' } // main → host: begin teardown (run onDispose, then exit)

/** Reserved event channel the host activity signal rides on (drives useActive / g.active). */
export const ACTIVE_CHANNEL = '$active'

/** A minimal duplex a client/host binds to. The concrete transports (parentPort, the preload
 *  bridge) implement this in U2/U3; the runtimes here are transport-agnostic. */
export interface Transport {
  send(msg: WireMessage): void
  /** Subscribe to inbound messages; returns an unsubscribe fn. */
  onMessage(cb: (msg: WireMessage) => void): () => void
}
