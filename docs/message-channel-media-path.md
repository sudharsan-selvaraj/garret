# Direct media path — MessageChannelMain

## Problem

Every host→UI message rides the two-hop relay: **host (utilityProcess) → main → renderer (guest webview)**.

- `host.ts` — `out.push(chunk)` → `parentPort.postMessage({t:'chunk',data})` → structured-clone into main (`child.on('message')`).
- `lane.ts:131` — `host.onFrame((msg) => webContents.fromId(wcId).send(extHostFrame, msg))` → structured-clone into the guest.

So each media frame's `Uint8Array` is **structured-cloned twice** and its backing bytes **copied twice**, with main as an unavoidable middleman. For a 60fps 8Mbps H.264 stream + Opus audio, that's the hottest path in the app and it all lands on the main process.

## Goal

Give the media stream a **direct host↔guest channel** (a transferred `MessagePort`), so downstream stream data flows in **one hop**, off the main process, with **optional zero-copy transfer** of frame buffers. Control stays where it is. Fully backward-compatible and transparent to widget authors (except an opt-in transfer hint).

## What moves, what stays

Split by direction/volume, chosen so ordering is never split across transports:

| Message | Transport | Why |
|---|---|---|
| `req`/`res`/`err` | main relay (unchanged) | low volume; correlation + capability scoping live in main |
| `event` | main relay (unchanged) | low volume, unsolicited; main may observe |
| `stream_start`, `cancel` (UI→host) | main relay (unchanged) | upstream, low volume; host only pushes *after* start is processed |
| **`chunk`, `stream_end`, `stream_err` (host→UI)** | **direct port** (when present) | the hot path; end/err share the port so they can't overtake the last chunk |

Key ordering rule: **a stream picks its downstream transport once, at start, and keeps it for its whole life.** The port is brokered at host launch (before any stream), so streams normally start with the port available. If a stream ever starts before the port is ready, it stays on the main relay for its lifetime — never mixed.

## Architecture

```
                    ┌──────── main (broker only at setup) ────────┐
launchHost(wcId) →  │  const {port1,port2} = new MessageChannelMain│
                    │  child.postMessage({t:'port'}, [port1])      │  ──▶ host utilityProcess
                    │  guestWC.postMessage(extMediaPort,{},[port2])│  ──▶ guest webview
                    └──────────────────────────────────────────────┘
                                        (main is NOT in the per-frame path after this)

host  ── port1 ──────────────── chunk/stream_end/stream_err ──────────────▶ port2  guest
      (transfer [buf] optional)                                            (SDK client dispatches by id)
```

- **Brokering** (main, `lane.ts`/`host.ts`): when a host is launched and bound to a guest `wcId`, main creates one `MessageChannelMain` and transfers `port1` to the host (`child.postMessage(msg,[port1])`) and `port2` to the guest (`webContents.fromId(wcId).postMessage(Channels.extMediaPort,{},[port2])`). Exactly the same host↔guest pairing as the existing `onFrame` relay → **no new scoping surface**: a guest only ever receives a port to its own host.
- **Host SDK** (`host.ts`): on receiving the `MessagePortMain`, store it as `fastPort`. `driveStream` captures `fastPort` at start; `out.push`/`end`/`error` for that stream write to it (`fastPort.postMessage(msg, transfer)`) instead of `send()`. No port → current `send()` path.
- **Guest** (`extBridge.ts`): on receiving the port (`ipcRenderer.on(extMediaPort, e => e.ports[0])`), `start()` it and forward its `message` events into the SAME inbound `frameCbs` the relay feeds — so the SDK client sees one merged stream of `WireMessage`s and dispatches by `id` exactly as today. The client needs no change.

## Zero-copy transfer (opt-in, Level 2)

Two levels, shipped/considered separately:

- **Level 1 (default, safe):** one hop instead of two. Chunks are still structured-cloned (copied once) but main is out of the path. Removes copy #2 and the main-process load. No transfer, no neutering — zero author foot-guns.
- **Level 2 (opt-in):** `ctx.stream`'s `push` gains an optional transfer list — `out.push(chunk, [chunk.data.buffer])`. When a fast port is active, those `ArrayBuffer`s are passed as the port's transfer list (neutered, zero-copy). The author owns correctness: **only transfer a buffer you won't reuse and that isn't fanned out to multiple subscribers** (transfer neuters it for any second reader). The mirror's per-frame scrcpy buffer is fresh and single-consumer (one video subscriber per surface) → safe.

`StreamOut.push` becomes `push(chunk, transfer?: readonly ArrayBuffer[])`. Backward-compatible (optional arg); ignored on the relay path.

## Backward-compatibility

- Non-streaming widgets, events, req/res: unchanged.
- A host/main/guest that never negotiates a port: everything works over the existing relay (the port is purely additive; every message type still has its relay path).
- `ctx.stream` and `useHost`/`StreamCall` APIs unchanged except the optional `transfer` arg to `push`.
- The mirror keeps calling `host.mirror().onData(...)`; only its host-side `out.push` optionally gains a transfer list.

## Risks / review focus

1. **Ordering across transports** — mitigated by keeping a stream's entire downstream on one transport, chosen at start. Verify `stream_end`/`stream_err` can never arrive before the final `chunk`, and that `cancel` (main) racing late chunks (port) is benign (guest drops by id after cancel).
2. **Port lifecycle / leaks** — the port must be closed on host dispose, guest unmount, and surface close; a MessagePortMain kept alive after teardown leaks. Broker must not double-send a port on host relaunch.
3. **Transfer neutering** — Level 2: a transferred buffer reused by the host (or fanned to a second sink) becomes detached → corruption. Constrain to single-consumer streams; document loudly; default off.
4. **Port arrival race** — a stream starting before `port2` reaches the guest, or before `fastPort` reaches the host. Decide-transport-at-start handles the host side; the guest merges both inbound sources so a relay-borne stream still resolves.
5. **utilityProcess ↔ renderer port support** — confirm Electron transfers `MessagePortMain` to a `utilityProcess` (`child.postMessage(msg,[port])`) and to a webview guest (`webContents.postMessage`), and that `e.ports` surfaces in both the host parentPort handler and the preload.
6. **Structured-clone parity** — the port uses the same structured-clone algorithm, so `Uint8Array`/`Date`/`Map` chunks survive identically. Verify no reliance on main having observed the frame.
7. **Security** — the port bypasses main; confirm nothing in main *needed* to see chunks (it doesn't — relay is a dumb forward), and the port pairing is strictly host↔its-own-guest.

## Review outcome (incorporated)

Design review verdict: **feasible, no blockers.** All three Electron legs confirmed (port transfer to
utilityProcess via `child.postMessage(msg,[port])` → host `parentPort` event `.ports`; to the guest via
`webContents.postMessage(ch,msg,[port])` → preload `ipcRenderer.on` event `.ports`), and the `lane.ts`
relay is a pure forward, so chunks may skip main with no loss of scoping/correlation. Required changes,
now baked into the phasing:

- **Broker the host port AFTER `{t:'ready'}`, not at fork** — a message posted to the utilityProcess
  before its `parentPort` handler is attached (during `defineHost` eval) is dropped. Send `port1` from
  `host.ts`'s `child.on('message')` ready branch (or gate on `this.ready`), else streams silently fall
  back to relay with zero benefit and no error.
- **Run port inbound through the existing `inbound[]`/`hasSubscriber` gate** in `extBridge.ts` — the
  guest buffers frames until the SDK client attaches its first `onMessage`. Don't `port.start()` (or
  don't push into `frameCbs`) until the client has subscribed, or early chunks are dropped. The
  MessagePort itself queues until `start()`, so the safe move is: funnel port messages through the same
  `inbound[]` buffer the relay uses.
- **SDK `parentPort` handler must capture `e.ports`** — add a `{t:'port'}` handshake branch that stores
  `e.ports[0]` as `fastPort` (today `PortEvent` is typed `{data}` only).
- **Client must ignore a `chunk`/end for an unknown/cancelled id** (cancel rides the relay while late
  chunks ride the port) — confirm it drops silently, doesn't throw.
- **Lifecycle:** create the channel only for hosted (`nodeEntry`) widgets; if `launchHost` throws after
  channel creation, close both ports; the guest listens for port `close` (host death) as a "lost"
  signal. Webview reload = fresh document = fresh port, so relaunch replacement isn't a concern.

### The strategic question — measure before building the port layer (M0)

The expensive part is the **byte copy** (8 Mbps × 60 fps × 2 hops), not main's per-frame **dispatch**
(~120 msgs/s). Both existing hops *may* already support zero-copy transfer with no new channel:
`child.postMessage(msg,[buf])` (host→main) and `webContents.postMessage(ch,msg,[buf])` (main→guest) —
main stays in the path but only dispatches. **If Electron honors `ArrayBuffer` transfer over its
main↔renderer IPC, that removes the copy with a fraction of the machinery and the whole MessagePort
layer is unnecessary.** The open question: Node/utilityProcess `postMessage` honors `ArrayBuffer`
transfer, but it's unconfirmed that Electron's `webContents.postMessage` → `ipcRenderer` honors
`ArrayBuffer` transfer (its transfer list is documented for `MessagePort`s). A **real MessageChannel**
(this design) honors transfer end-to-end regardless — that's its durable advantage, plus taking main
out of the path.

**Decision gate (M0):** a ~30-line spike measuring (a) whether `webContents.postMessage` transfers an
`ArrayBuffer` zero-copy, and (b) main-process CPU during a live mirror with the current relay. If (a) is
yes and main CPU is negligible → ship the simpler transfer-on-existing-hops and **drop this design**. If
(a) is no or main CPU is meaningful → proceed with the MessagePort (M1+).

## Phased implementation (each phase ends with an adversarial review)

- **M0 — measure + decide (do FIRST):** spike the `ArrayBuffer`-transfer-over-IPC question + baseline
  main CPU during a live mirror. Pick simple-transfer vs MessagePort based on data. May end here.

- **M1 — broker + transport plumbing:** MessageChannelMain at host launch; deliver port to host + guest; guest merges port inbound into `frameCbs`; host routes stream downstream to `fastPort` when present; **Level 1 only** (no transfer). Lifecycle/close on dispose. Prove the mirror runs entirely off the relay for chunks.
- **M2 — zero-copy transfer:** `push(chunk, transfer?)`; mirror transfers its frame buffers; measure.
- **M3 — verify + harden:** ordering/leak/teardown review; fallback paths; docs.

## Success criteria

- With a mirror open, main-process CPU for the media relay drops to ~zero (chunks no longer traverse main).
- No regression to req/res/events/lifecycle or to any non-streaming widget.
- Clean teardown: no leaked `MessagePort`s across open/close/reload/rotate/disconnect.
