# Android Devices

List, mirror, and fully control connected Android devices from a Garret widget. A board widget shows
live devices; clicking one opens a floating "phone on the desktop" window that streams the screen and
lets you drive it with mouse, keyboard, and on-screen nav controls.

## Features

- **Live device list** — event-driven (adb `host:track-devices`, no polling); shows marketing names
  (e.g. "OnePlus Nord 5", "Galaxy S21") resolved from device props, plus `unauthorized`/`offline` state.
- **Screen mirror** — H.264 video via scrcpy, decoded with WebCodecs → a WebGL canvas. One floating,
  transparent, aspect-locked window per device; rotation-aware.
- **Audio** — Opus stream decoded with WebCodecs → Web Audio, kept in sync with the video.
- **Full control** — tap/drag/scroll (mouse), hardware keyboard (typing + shortcuts), and a vertical
  control column: Back / Home / Recents + Power / Volume / Rotate / Notifications.
- **Resilient** — the mirror shows a "connection lost → Reconnect" card on unplug; the list
  auto-recovers if the adb connection drops.

## Requirements

- **Android platform-tools (`adb`)** installed and on `PATH` (or in a standard Android SDK location).
  The host talks to your **local adb server** (`127.0.0.1:5037`); it does not embed adb. If no server
  is running it will try to start one via the found `adb`. Install: `brew install android-platform-tools`.
- **USB debugging** enabled on the device, and the "Allow USB debugging" prompt authorized.

No extra install for scrcpy — the scrcpy server jar is bundled and pushed to the device automatically.

## Build & install

```sh
node build.mjs        # fetches scrcpy-server.jar, bundles host + both UIs, writes dist/ + pack/
# → zip the pack/ dir into adb-devices.garret (see the repo's build step)
```

Then in Garret: **Settings → Widgets → Add widget…** and pick `adb-devices.garret`. Place the
"Android Devices" widget on the board; click a device (▶) to open its mirror.

## Architecture

```
UI (webview, garret://)                Host (Node, utilityProcess)          Local adb server → device
 ├─ ui/            device list          host/index.ts   host API + lifecycle
 └─ ui/mirror/     mirror surface        host/adb/
     main  video/decoder wiring           connection    adb server discovery / autostart
     audio Opus → Web Audio               tracker       live device tracking (no polling)
     pointer/keyboard/NavBar control      mirror        scrcpy session (video/audio/control)
                                          session       one session hub, fans out + serializes control
                                          deviceName    marketing-name resolution (getprop, cached)
```

- **Host tier** (`capabilities: ["process", "windows"]`): raw Node, runs `ya-webadb` against the local
  adb server and manages scrcpy sessions. One host process per placed surface.
- **UI tier**: the list widget and the per-device mirror surface, each a webview. Control input and
  media flow over the SDK host bridge.
- **Surfaces**: the mirror is a `windows`-capability surface — a floating, frameless, transparent
  window whose device area stays aspect-locked (the control column is reserved via `setAspectRatio`'s
  inset).

## Version coupling (important)

The scrcpy stack is pinned **exact**. Three things must move together:

1. `SCRCPY_VERSION = '3.3.1'` in `host/adb/mirror.ts`
2. the option class `AdbScrcpyOptions3_3_1` (same file)
3. the jar URL (v3.3.1) in `build.mjs`

scrcpy **3.3.1 is required for modern Android** — 2.x fails on Android 14+ (`SurfaceControl.createDisplay`
was removed; verified live on Android 16). `@yume-chan` npm versions are decoupled from scrcpy protocol
versions, so the 2.3.x packages expose the `3_3_1` option class.

## Limitations

- Requires a local adb server + USB debugging (no built-in wireless pairing flow yet).
- Single-touch pointer (no multi-touch / pinch-zoom).
- Audio requires Android 11+ (silently absent otherwise).
