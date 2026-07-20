# Device Control plugin — design & plan

**Status: design, pre-implementation.** Evolves `examples/sdk/adb-devices` into a full device-control
plugin: a live device **list** surface + one floating **mirror** surface per device (screen + control),
built on the unified SDK + the floating-surface-windows primitive ([[floating-surface-windows]]).

## Decision log

- **Transport: LOCKED → ya-webadb over the adb-server TCP transport** (`AdbServerClient` +
  `@yume-chan/adb-server-node-tcp`, connect to `127.0.0.1:5037`). Host-based, USB + wifi, robust.
- **System adb: REQUIRED → detect & guide.** ya-webadb's TCP transport connects to a running adb
  server; it doesn't embed adb. If unreachable, the list surface shows an install hint
  (`brew install android-platform-tools`); if `adb` is on PATH but no server is up, the host
  auto-starts it (`ctx.spawn('adb','start-server')`).
- **Mirror: scrcpy via ya-webadb** (`@yume-chan/adb-scrcpy` pushes `scrcpy-server.jar`; H.264 decodes
  in the webview via WebCodecs). **Screen + audio (Android 11+) + full interactive control** are all
  v1 scope; the `.jar` (~60 KB, Apache-2.0) ships as a plugin asset.
- **Rejected alternatives** (see the chat exploration): *bundle adb* — deferred (per-arch binary +
  port/version coexistence; a v1.1 zero-install enhancement); *WebUSB direct* — needs a sandbox
  permission carve-out + moves the device connection into the UI (separate track); *wireless-debugging
  direct `adbd`* — no binary but wifi-only + the Android-11 pairing handshake is real work (future);
  *AirDroid-style companion app* — a whole Android app that still can't do full control without
  adb/Accessibility (wrong scope for a widget).

## Plan review — blockers folded (before Phase A)

An adversarial review of this plan flagged four things that must be resolved in the design first:

- **[#1 Video pipeline over IPC] — the real risk is buffering, not throughput.** Steady-state is fine
  (compressed H.264 ≈ 1 MB/s, ~30–60 chunks/s), but our wire has **no backpressure** and TWO
  unbounded/silent buffers during the subscribe race: the preload's `inbound[]` (unbounded) and the
  SDK client's `s.buffer` (capped at 1000, **silently discarded** on overflow). Resolution:
  1. **Start the scrcpy video/audio streams lazily** — the host opens the session only when the UI's
     `host.mirror()`/`host.audio()` stream is actually subscribed (`.onData` attached), and stops on
     the `ctx.stream` cancel signal. Never produce into an unattached buffer.
  2. **Cap the source**: scrcpy `videoBitRate` (default 8 Mbps) + `maxFps` (default 60) in
     `ScrcpyConfig`, exposed so the user can lower them.
  3. Treat buffer overflow as a **surfaced error / stream reset**, not a silent drop (SDK-side; noted
     as a small SDK hardening — bounded preload buffer + error-on-overflow).
- **[#6 One host per surface — NOT a global singleton].** Each surface instance self-binds → its OWN
  host (per the surfaces design). So the **list** host holds the `trackDevices` observer + one adb
  connection; **each mirror window** is a separate host with **its own adb connection + its own scrcpy
  session** for that serial. That's fine (the adb server multiplexes clients; each device has its own
  server instance). Cleanup is mandatory: on mirror-window close the host is killed → use
  `ctx.onDispose` to **stop the scrcpy session + kill the device-side server + cancel the streams**,
  or the device leaks a running `scrcpy-server` process. (The plan's earlier "connection singleton"
  wording meant per-host, not global — corrected here.)
- **[#2 WebCodecs vs CSP] — DECIDED: WebCodecs-only, no tinyh264.** `VideoDecoder`/`AudioDecoder` are
  plain JS APIs on a secure origin — our per-tier CSP (`connect-src 'none'`, `script-src 'self'`)
  does **not** block them, and Electron always ships hardware H.264/AAC/Opus decode. The `tinyh264`
  wasm fallback WOULD need `wasm-unsafe-eval` in the CSP; we **drop the fallback** rather than loosen
  the CSP. (Revisit only if a target device emits a codec WebCodecs can't handle.)
- **[Phase A window specifics].** Frameless + transparent + resizable + `alwaysOnTop` do coexist on
  macOS, but: (a) a frameless transparent window has no native resize chrome — we lock it with
  `win.setAspectRatio(deviceW/deviceH)` and allow edge-resize; (b) the device resolution is unknown
  until the first video frame, so aspect can't be a static manifest value — the surface must set it
  **at runtime**. Resolution: Phase A ships (i) static manifest/open options `frame:false` +
  `transparent:true`, AND (ii) a small **generic self-window API** `g.window.setAspectRatio(r)` /
  `g.window.resize(w,h)` that only affects the caller's OWN surface window (no-op for board widgets).
  Drag via a CSS `-webkit-app-region: drag` strip; a custom close button (no native chrome).

**Implementation-watch (not plan blockers):** control input should go over a **dedicated upstream
control stream / batched sends**, not one `invoke` round-trip per pointer-move (drag/scroll rates);
pin the bundled `scrcpy-server.jar` **version to the `@yume-chan/scrcpy` client version** and resolve
its packed path via the host's asset dir.

## Prerequisites (user-facing)

- **System:** Android platform-tools (`adb`). Nothing else — no desktop scrcpy, no ffmpeg, no Java,
  no libusb.
- **Device:** USB debugging enabled + the Mac authorized (RSA prompt). Android 5+ for video; **11+ for
  audio** (older devices fall back to video-only — audio stream absent, not an error).

## Dependencies (all pure-JS → bundled into the host; no `.node`)

| Package | Role | Runtime |
|---|---|---|
| `@yume-chan/adb` | core + `AdbServerClient` + `trackDevices` observer | host |
| `@yume-chan/adb-server-node-tcp` | connect to the local adb server | host |
| `@yume-chan/adb-scrcpy` | push scrcpy-server, start session, video/control streams | host |
| `@yume-chan/scrcpy` | scrcpy protocol (control encode, packet parse) | host + UI |
| `@yume-chan/scrcpy-decoder-webcodecs` | H.264 → frames (Electron WebCodecs) | UI |
| WebCodecs `AudioDecoder` (Electron built-in) | scrcpy audio (Opus/AAC) → PCM → Web Audio | UI |
| `scrcpy-server` (`.jar`) | runs on the device via `app_process` | pushed asset |

## Architecture (MVC across the 3 runtimes)

Strict layering; each concern in its own module; the **shared contract** is the only coupling.

```
                    shared/ (contract — both sides compile against it)
                    ├─ types.ts   Device, DeviceState, ScrcpyConfig, ControlEvent, VideoChunk
                    └─ api.ts     Host API: methods + streams + events

HOST (Model + device I/O, raw Node)              UI (View + view-model, webview React)
├─ host/index.ts    defineHost — thin controller ├─ ui/list/    DeviceList (view)
├─ host/adb/connection.ts  server client + detect│    └─ useDevices()   (view-model: subscribe events)
├─ host/adb/tracker.ts     trackDevices observer ├─ ui/mirror/  DeviceMirror (view: canvas + input)
├─ host/adb/mirror.ts      scrcpy session/serial │    ├─ useMirror(serial) (view-model: stream lifecycle)
├─ host/adb/control.ts     touch/key → scrcpy    │    ├─ decoder.ts (WebCodecs H.264 → canvas)
└─ host/adb/actions.ts     screenshot/reboot/…    │    └─ input.ts   (pointer/key → ControlEvent)
                                                  └─ ui/shared/  presentational components
```

Views are presentational; hooks (`useDevices`/`useMirror`) are the view-models holding all
lifecycle/effect logic; host services are the model. No view touches IPC directly — it goes through a
hook → the `shared/api` contract → the host.

## Data flow (each direction explicit)

- **Device → Host:** ya-webadb over the adb-server TCP socket — the tracker observer + the scrcpy
  session's video / device-message streams.
- **Host → UI (events):** `ctx.emit('devices:changed', list)` → `useHostEvent` — live list, **no polling**
  (`trackDevices` = adb `host:track-devices` push socket).
- **Host → UI (video stream):** `host.mirror(serial)` → `Stream<VideoChunk>` — compressed H.264 packets
  (~1 MB/s; trivial over IPC) → `useMirror` feeds WebCodecs → canvas.
- **Host → UI (audio stream):** `host.audio(serial)` → `Stream<AudioChunk>` (Opus/AAC packets; ends
  immediately on <11 devices) → WebCodecs `AudioDecoder` → Web Audio playback.
- **UI → Host (commands):** typed calls — `host.control(serial, event)`, `host.startMirror(serial, cfg)`,
  `host.screenshot(serial)`.
- **UI → UI (composition):** list → `g.surfaces.open('device-mirror', { key: serial, props: { serial, model } })`;
  `g.surfaces.onClosed` clears the row's "mirroring" state (reload-durable).

## The mirror surface — "phone on the desktop"

Needs a small, **generic** extension to the surface primitive (device-agnostic, reusable):
- surface manifest / `open` gains window-style options: **`frame: false`**, **`transparent: true`**,
  **`aspectRatio`** (or the host calls `win.setAspectRatio(w/h)` once it knows the device resolution).
- The mirror UI: a `<canvas>` filling the transparent window at the device aspect ratio, rounded
  corners (subtle bezel or bezel-less), decoded video painted per frame, a thin CSS drag region
  (`-webkit-app-region: drag`) so the frameless window moves, and a small close affordance. Result:
  a rounded phone screen floating over the desktop, one per device.

## Capabilities / manifest

`capabilities: ["process", "windows"]` → full tier (host + a system cap). `process` covers
`adb start-server` (raw TCP to the local server is unrestricted host `net`, needs no capability);
`windows` gates opening the mirror surface. `surfaces.device-mirror` declared per the surface spec.

## Phasing (each phase → adversarial review, per workflow)

- **A. Surface primitive: window styling + self-window API** (generic; extends floating-surface-
  windows). Static manifest/open options `frame:false` + `transparent:true`; a runtime
  `g.window.setAspectRatio(r)` / `resize(w,h)` scoped to the caller's own surface window (no-op for
  board widgets). *This is the only phase that touches the shared primitive — device code starts at B.*
- **B. Host: live tracking + adb detection** — swap one-shot `listDevices` for `trackDevices` →
  `devices:changed`; detect/guide/auto-start adb. List UI goes live.
- **C. Host: scrcpy session** — `startMirror` + `mirror` (video) & `audio` streams + control channel;
  bundle & push `scrcpy-server.jar`.
- **D. UI: mirror surface (view-only)** — WebCodecs video → canvas, phone chrome, `g.surfaces.open`
  per device. *Early win; validates the full pipeline.*
- **E. UI: audio** — WebCodecs `AudioDecoder` → Web Audio (video-only fallback on <11).
- **F. UI: control** — pointer/keyboard → scrcpy control; then one-shot actions (screenshot/reboot).

## Live verification checklist (needs a device — deferred from Phase C)

Phase C was validated structurally (typecheck + bundle) but not live. Confirm with a device attached:
1. scrcpy-server accepts launch `version='3.3.1'` against the `v3.3.1` jar (version mismatch = hard fail).
2. Sustained mirror with video **and** audio, and video-only, and audio-only — no stall (the hub drain fix).
3. `scrcpy-server` on the device is actually killed on window close **and** on stream cancel (`adb shell ps | grep scrcpy`).
4. cancel → re-subscribe yields a working session (hub reset-on-empty).
5. unauthorized / offline / Android <11 (no audio) devices surface usable errors, not a hang.
6. `__dirname/scrcpy-server.jar` resolves in a packed/installed `.garret`.
7. 8 Mbps / 60fps doesn't hit the SDK's no-backpressure drop path (Phase D must attach `.onData` synchronously + decode from the next keyframe on any gap).

## Confirmed decisions

1. **Control:** full interactive control (touch + keyboard) is v1 scope; **built view-only first (D),
   control in (F)** for an early, testable win.
2. **Audio:** **included** (Android 11+; older devices fall back to video-only, not an error).
3. **`scrcpy-server.jar`:** bundled in the plugin as a pushed asset (Apache-2.0).
4. **Library:** ya-webadb for both tracking and mirror (no adbkit — avoids mixing two adb libraries).
