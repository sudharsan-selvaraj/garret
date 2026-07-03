# Device Control — Phase F: input control

Turn the mirror from view-only into a fully controllable device: pointer (tap/drag/scroll),
hardware keyboard, and one-shot nav/system actions. The scrcpy control channel already exists
(`MirrorSession.controller`, wired through `openMirror`); Phase F exposes it to the UI and captures
browser input on the mirror canvas.

## Locked decisions (from prior phases)

- Full control (not view-only). Single scrcpy session per device (the hub). WebCodecs video already
  gives us the current displayed frame dimensions via `decoder.sizeChanged` (rotation-aware).

## Architecture (MVC, same split as the rest of the plugin)

```
UI (mirror canvas)                Host (controller boundary)          Device
 pointer/key/wheel  ── host.* ──▶  hub.control() → ScrcpyControl…  ──▶ scrcpy server
```

### 1. Host: expose the controller through the hub

`MirrorHub` gains one accessor that runs a fn against the live controller — the writer never escapes
the hub, so its "released on close" lifecycle stays enforceable in one place:

```ts
control(fn: (c: ScrcpyControlMessageWriter) => Promise<void>): Promise<void>
```

- It resolves the *same* `sessionP` the streams use — no second connection — and invokes `fn` only if
  the session is open, not `closed`/`failed`, and has a controller. Otherwise it no-ops.
- **Best-effort + guarded (BLOCKER 2 fix):** `fn` runs in try/catch and errors are swallowed. Between
  awaiting sessionP and writing, the hub can close (last unsubscribe → `onEmpty` → `session.close()`
  releases the writer) or swap on re-open — a write to a released writer throws, so control input, like
  audio, must never surface an error or tear down anything. Re-check `closed` immediately before `fn`.

**Control NEVER creates a hub (BLOCKER 1 fix).** The hub's only teardown trigger is `refDroppedToZero`
on stream unsubscribe; a hub with no subscribers is never reclaimed. So control MUST use the *existing*
hub only — the host reads the module-level `hub` directly, guarded (`if (!hub || hubSerial !== serial)
return`), and NEVER calls `getHub`. The mirror UI always `subscribeVideo`s on mount, so a live surface
always has a hub; a control call with no active mirror legitimately no-ops (never spins up a zombie
scrcpy session).

### 2. Host API (new methods on `Api`) — the controller boundary

All take `serial` (consistent with `mirror`/`audio`) and are request/response (`Promise<void>`), NOT
streams. Coordinates are **normalized [0,1]** against the *currently displayed* frame, plus the frame
dims `w,h` the UI already tracks — so mapping stays correct across rotation without the host tracking
device geometry.

```ts
pointer(a: { serial; action: 'down'|'move'|'up'; x: number; y: number; w: number; h: number }): Promise<void>
key(a: { serial; action: 'down'|'up'; keyCode: number; metaState?: number; repeat?: number }): Promise<void>
text(a: { serial; text: string }): Promise<void>
scroll(a: { serial; x: number; y: number; w: number; h: number; dx: number; dy: number }): Promise<void>
action(a: { serial; kind: 'back'|'home'|'appSwitch'|'power'|'volumeUp'|'volumeDown'|'rotate'|'notifications' }): Promise<void>
```

Host mapping (**finger-with-pressure model** — matches scrcpy's own web client; no mouse-button
fields, so no `actionButton`-on-move ambiguity):
- `pointer` → `injectTouch({ pointerId: PointerId.Finger, action: Down/Move/Up, pointerX: clamp01(x)*w,
  pointerY: clamp01(y)*h, videoWidth: w, videoHeight: h, pressure: action==='up'?0:1, buttons: 0,
  actionButton: 0 })`. **Clamp x,y to [0,1]** — `setPointerCapture` delivers moves from outside the
  canvas, so raw normalized coords can exceed the frame.
- `key` → `injectKeyCode({ action, keyCode, repeat: repeat??0, metaState: metaState??0 })`.
- `text` → `injectText(text)`.
- `scroll` → `injectScroll({ pointerX: clamp01(x)*w, pointerY: clamp01(y)*h, videoWidth: w,
  videoHeight: h, scrollX: dx, scrollY: dy, buttons: 0 })`. **Magnitude:** 3_3_1 divides scroll by 16
  internally, so map wheel delta to a tunable step (verify live — ±1 is nearly imperceptible).
- `action` → keycodes (down+up) for back(4)/home(3)/appSwitch(187)/power(26)/volumeUp(24)/volumeDown(25);
  `rotateDevice()` for rotate; `expandNotificationPanel()` for notifications.

**Serial guard** (defense-in-depth, NOT the security boundary — that's the per-surface host process +
Phase-D embedder-scoping): each method no-ops unless `serial === hubSerial`. Note: `text`/`action`
inject into whatever is focused on the phone; acceptable under this plugin's full-access-local-adb
trust model.

### 3. UI: capture input on the canvas

- **Pointer:** `pointerdown` on the canvas → `setPointerCapture`; `down` then `move` on `pointermove`
  (throttled to animation frames), `up` on `pointerup`/`pointercancel`/`lostpointercapture`. Map
  `offsetX/offsetY / canvasRect → [0,1]`, send with the current frame `w,h` (tracked from
  `sizeChanged`/`meta`). Coalesce moves: at most one in flight per rAF; drop if the previous send is
  pending (control must never build a backlog — same lesson as audio).
- **Keyboard:** the surface window must give the guest webview focus (verify before F3). `keydown`/
  `keyup` scoped to when the screen has focus (listener added/removed with the effect). **Key-vs-text
  is mutually exclusive per keystroke** (never both — that double-types): keys with an Android keyCode
  (nav/enter/backspace/arrows/modifiers) → `key`; character entry → `text`. metaState from the generic
  `Shift/Ctrl/Alt/Meta` bits (not `*Left/*Right`). `preventDefault` only for keys we actually forward.
- **Wheel:** `wheel` → `scroll` (normalize deltas to ±1 steps).
- **Nav bar:** a thin auto-hiding control strip (Back / Home / Recents) at the bottom of the mirror,
  plus a small overflow (power, volume, rotate, notifications). Native-minimal: icons only, appears on
  hover, `-webkit-app-region: no-drag` so taps don't move the window. Lives in the guest (below the
  video) — NOT in the host titlebar (that's window chrome).

### 4. Coordinate correctness

The canvas fills the webview and is aspect-locked to the frame, so `offset/rect` normalization maps
1:1 to the device surface. On rotation, `sizeChanged` updates `w,h`; a gesture in flight during a
rotation is cancelled with `AndroidMotionEventAction.Cancel` (NOT `Up` — else the app sees a
tap-release at a stale coordinate and may fire a spurious click).

## Risks / review focus

1. **Backpressure:** injectTouch on every `pointermove` can flood the control socket. Coalesce to rAF
   + single-in-flight; drop intermediate moves (never queue). Verify no unbounded `Promise` buildup.
2. **Serial spoofing:** confirm host methods reject a foreign serial (defense in depth even though one
   host = one device).
3. **Key capture leakage:** `keydown` listeners must be scoped to the surface window and removed on
   unmount; `preventDefault` must not break the close button / devtools.
4. **Pointer capture / lost events:** dragging out of the window must still deliver `up`
   (`setPointerCapture` + `lostpointercapture`), or the device sticks in a pressed state.
5. **Control before session ready:** early input (session still opening) must no-op cleanly, not throw.
6. **Teardown:** control writer is released/closed by the existing `session.close()`; no extra leak.

## Sub-phases (each ends with an adversarial review, blockers fixed before next)

- **F1+F2 — plumbing + pointer (merged):** hub `control(fn)` (existing-hub-only, guarded), host
  `pointer/key/text/scroll/action` + serial guard + api types, AND the canvas pointer capture
  (tap/drag/scroll, coalescing, clamp, capture correctness). Merged so the plumbing is exercised by
  real input rather than reviewed against nothing.
- **F3 — keyboard:** confirm guest focus first; code→keyCode table, metaState, key-vs-text exclusivity,
  scoped capture + cleanup.
- **F4 — nav/system UI:** Back/Home/Recents strip + overflow (power/volume/rotate/notifications).
