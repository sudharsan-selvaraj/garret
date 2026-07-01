# Garret — core architecture (the five pillars)

The foundations everything else sits on, ordered by **how expensive they are to change later**.
The top ones will break the SDK, the security model, and the UX if they're wrong early. This doc is
the authoritative status of each: what it is, what we've actually built (with file references), and
the decisions still open before the `garret` SDK (docs/garret-sdk-guide.html) freezes the contracts.

> Companion docs: `docs/native-ext-sdk-design.md` (SDK design, rev 2, critic-hardened),
> `docs/native-phase3-design.md` (install/consent), `docs/native-ext-dx-review.md` (P1–P10),
> `docs/sandbox-design.md` (web tier), `docs/garret-sdk-guide.html` (authoring), `docs/garret-overview.html` (product).

## Scorecard

| # | Pillar | Status | Note |
|---|---|---|---|
| 1 | Window level model | ✅ **Solved** — stronger than pure Electron | native addon, not just `setAlwaysOnTop` |
| 2 | IPC bridge protocol | 🟡 **Envelope done; streaming wire not frozen** | adopt first-class `stream_*` frames before the SDK |
| 3 | Renderer isolation | ⚠️ **Open decision** | on `<webview>`; evaluate `WebContentsView` now |
| 4 | Native host lifecycle | 🟡 **Core done; 2 gaps** | graceful-shutdown ladder + env scrub unbuilt |
| 5 | Capability enforcement | ✅ **Solved** | main-enforced, signed consent, re-consent on change |
| 6 | Power / visibility (cross-cutting) | 🟡 **Throttle built; occlusion signal pending** | HUD-gated poll stretch + `backgroundThrottling`; the real battery risk, not the render primitive |

---

## 1. Window level model — ✅ solved (harder than it looks; pure Electron was insufficient)

**What it is.** One `BrowserWindow` in two states: *Ambient* (desktop level, below apps, above
wallpaper, click-through) and *HUD* (above everything incl. full-screen Spaces, focusable). Get this
wrong and the product doesn't exist.

**What we built.** Pure `win.setAlwaysOnTop(true, 'desktop')` was **not enough** — it didn't survive
full-screen Spaces and produced a Mission Control tile. We use a **native addon**
(`native/mac_window.mm`, built to `garret_mac.node`, wrapped by `src/main/native/macWindow.ts`):

- `pinToDesktop(handle, offset)` → `window.level = kCGDesktopIconWindowLevel + offset`,
  `collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces` (ambient).
- `raiseToHud(handle)` → `kCGScreenSaverWindowLevel` + `CanJoinAllSpaces | FullScreenAuxiliary`
  (floats over another app's full-screen Space).
- `makePanel(handle)` → a **non-activating `NSPanel`** — the one window kind macOS lets float over a
  full-screen Space *without* activating the app / switching Spaces.
- `src/main/windows/createWindow.ts:81`: `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`
  — the critical flag.
- Click-through in ambient: `setIgnoreMouseEvents(true, { forward: true })`; window transparent.

**The subtle trap (documented in `mac_window.mm`).** *Level authority.* Electron's `setAlwaysOnTop`
and the native `window.level` must **agree** or they fight. The hard-won fix: the addon is the single
authority, and the desktop-level re-pin on `show` is guarded while HUD is up (see
`src/main/index.ts` `setHud`). Keep window geometry **stable across the level switch** — the
dim-backdrop / rise "feel" is CSS, not a resize.

**Status: done and battle-tested.** No open decision.

---

## 2. IPC bridge protocol — 🟡 envelope done, streaming wire not yet frozen

**What it is.** Every widget call/event/stream flows through this. Two hops:
`UI (renderer) ⇄ main (ipcMain) ⇄ native host (utilityProcess)`. Web widgets do only the left hop.
The SDK (`defineHost`/`useHost`/`ctx.stream`) is a thin wrapper over this wire — so the format must
be right *before* SDK code exists.

**What we built (and it's right on the fundamentals):**
- Envelope: `{t:'req',id,method,args}` → `{t:'res',id,ok,value?,error?}`; `{t:'event',channel,payload}`
  (`src/main/native/extensionHost.ts`).
- **Structured clone**, never manual JSON — `utilityProcess.postMessage` (main↔host) +
  `ipcRenderer.invoke` (renderer↔main), so `Uint8Array`/`Date`/`Map` survive. ✓
- **Per-instance correlation** — each `ExtensionHost` has its own `seq`, and there is **one host per
  placed instance** (keyed by the UI webview's `webContents` id in `src/main/native/lane.ts`). ✓
- **Synchronous stream registration** — the rev-2 SDK design resolves the `{__gxStream:id}` marker
  before any chunk, so chunks can't race `.onData`. ✓

**Open decisions (settle before the SDK):**
- **First-class stream frames.** Today streaming is *layered over the generic `event` channel*
  (`__gx_stream`). Proposed instead: dedicated wire frames —
  `stream_start / chunk / stream_end / stream_err / cancel`. Cleaner cancel semantics + a natural
  place for bridge-level backpressure. **Recommendation: adopt.** New target envelope:

  ```ts
  // req/res
  { t:'req',          id, method, args }
  { t:'res',          id, result }
  { t:'err',          id, code, message, hint? }
  // stream
  { t:'stream_start', id, method, args }        // UI → host
  { t:'chunk',        id, data }                 // host → UI (0..n)
  { t:'stream_end',   id, result }               // host → UI (once)
  { t:'stream_err',   id, code, message }        // host → UI
  { t:'cancel',       id }                        // UI → host
  // events
  { t:'event',        channel, payload }         // host → UI, unsolicited
  ```
  IDs namespaced `${instanceId}:${ulid()}` (per-instance today via per-host `seq`; formalize).
- **Backpressure.** rev-2 = coalesce + document host-side filtering. Proposed: **bridge-level
  batch/throttle** (don't push 10k `adb logcat` chunks across IPC). **Recommendation: bridge-level**
  (more defensive), with host-side filtering still encouraged.

---

## 3. Renderer isolation — ⚠️ the one open foundational decision

**What it is.** Each widget UI needs its own isolated renderer (process, session, CSP). The Electron
primitive chosen here defines the security boundary and is the **hardest thing to change later**.

**What we built.** We are **all-in on `<webview>`** (`src/renderer/src/native/NativeWidget.tsx`,
`src/renderer/src/sandbox/SandboxWidget.tsx`). Isolation itself is strong for the web tier:
`src/main/sandbox/session.ts` uses a **per-widget partition** with `setPermissionRequestHandler(deny-all)`,
`setPermissionCheckHandler(false)`, and `onBeforeRequest` cancelling any non-`garret-widget:` request
— all enforced in **main**, never the renderer. The **native** tier shares one
`persist:garret-native` partition (acceptable: full-access/trusted, no isolation to enforce; noted).

**The divergence.** Electron discourages `<webview>` and steers toward **`WebContentsView`** (Electron
28+/30+). Honest trade:

| | `<webview>` (current) | `WebContentsView` (proposed) |
|---|---|---|
| Isolation | Good (own process/session/CSP) | Best; the officially-supported path |
| Board integration | **A DOM element** — position/drag/z-order/scroll come free from the React grid | **Manual geometry** — hand-sync bounds to layout/drag/scroll/zoom every frame |
| Electron direction | Discouraged, historically buggy | The future |

The security gap is *smaller than it looks* — per-partition session + strict CSP + `contextIsolation`
+ `sandbox` are enforced in main regardless of primitive. The real cost of switching is **geometry
management for a movable widget grid**.

**Decision (OPEN):** stay on `<webview>` (keep board-layout simplicity, accept the tradeoff) **or**
migrate to `WebContentsView` now (better isolation, take on geometry-sync). *Decide before the SDK
freezes the render contract — this is the most expensive item to reverse.*

---

## 4. Native host process lifecycle — 🟡 core done, two known gaps

**What it is.** The strict contract that makes native extensions reliable.

**Target protocol:**
```
main forks host → host async-inits → host sends {t:'ready'} on the port
  → main arms a ready-timeout; no ready in 10s → kill + surface error to UI
  → steady state: requests flow
  → widget removed/disabled → main sends SIGTERM
  → host runs ctx.onDispose callbacks
  → host exits within 3s, else main SIGKILLs
```

**What we built (`src/main/native/extensionHost.ts`):**
- `utilityProcess.fork` (Electron's structured-IPC fork — correct over `child_process.fork` here). ✓
- `{t:'ready'}` + **10s ready-timeout**; `ready` rejects on early exit so requests don't hang. ✓
- **stderr/stdout piped + `[ext:<id>]`-prefixed in the core** (not the SDK). ✓
- Crash **surfaces as an error, no silent auto-restart** (dispose rejects pending). ✓
- **One host per placed instance** (keyed by webContents id). ✓

**Gaps (build in SDK step-4 main-side plumbing):**
- **Graceful shutdown ladder.** Today `kill()` is an immediate `child.kill()`. Need
  `SIGTERM → run ctx.onDispose → wait 3s → SIGKILL`. `ctx.onDispose` is designed (rev 2), unbuilt.
- **Env scrub.** We inject PATH; **delete `GARRET_*`** (and token-bearing vars) before spawn, and
  scrub them from `ctx.spawn` children. Designed (rev 2), unbuilt — matters once the SDK adds the
  secret-key env var.

---

## 5. Capability enforcement — ✅ solved (already the intended model)

**What it is.** `declared in manifest → verified at install (hash/signature) → enforced at runtime in
main`. Never in the renderer.

**What we built:**
- **Enforced in main:** `src/main/sandbox/net.ts` (SSRF/private-IP/host-allowlist), session
  `onBeforeRequest` cancels undeclared hosts, permission handlers deny by default.
- **Install record is the authoritative ceiling** — host-written, **HMAC-signed** (`.garret-ext.json`
  / `.garret-install.json`), never the user-writable `manifest.json`.
- **Consent is a signed record; any capability/code change re-triggers it** (Phase 3): native → any
  sha delta resets `enabled:false` + re-consent; sandbox → `addedPermissions` re-prompt. "Escalating a
  capability re-triggers consent" is implemented, not aspirational.
- Full-access hosts get **unrestricted `ctx.fetch`** — the bargain the user consented to.

**Remaining:** `GARRET_*` internal tokens must be scrubbed before spawn (see Pillar 4) and never
logged. Otherwise this pillar is complete.

---

## 6. Power / visibility — 🟡 throttle built; occlusion signal pending (cross-cutting)

**What it is.** Garret is an **always-on desktop layer**; macOS treats it as "visible" even when it's
sunk behind your apps, so the usual OS throttling may not kick in. That — not the render primitive —
is the real battery risk (and the historical drain). Confirmed by measurement: with the board +
widgets + the WebContentsView spike idle, **CPU sampled at 0.0%** across all Electron processes.
The primitive choice (Pillar 3) is **power-neutral** — `<webview>` and `WebContentsView` are the same
process/compositor model, and the spike's per-frame `setBounds` only fires *during* drag/scroll
(zero at rest). Battery is driven by **what widgets do while hidden**: polling, `rAF`/CSS animation,
occluded painting, chatty streams.

**What we built (this pass):**
- **HUD-gated poll throttle** (`src/main/poll/scheduler.ts`): `setBoardActive(active)` stretches every
  job's interval by `IDLE_MULTIPLIER` (×4) when the board is ambient, and snaps back to full rate +
  refreshes stale jobs when the HUD is raised. Not a hard pause — ambient widgets still tick, slower.
  First poll per widget still runs immediately on subscribe, so launch/summon is fresh.
- Wired to activity in `src/main/index.ts`: `setHud(active)` → `setBoardActive(active)`; desktop board
  **starts throttled**; `win` focus/blur as a bonus signal.
- **`backgroundThrottling: true`** made explicit (`src/main/windows/createWindow.ts`) — Chromium
  throttles renderer timers/`rAF` when the window is genuinely occluded (the OS-driven half; the
  scheduler stretch is the main-process half Chromium can't see).
- Already present: full **pause on system sleep** (`powerMonitor`), per-job backoff, jitter/stagger.

**Gaps / open:**
- **True occlusion signal.** HUD-state + focus/blur is a *heuristic* proxy for "hidden." macOS
  exposes no cheap "am I covered" API; Chromium's occlusion (via `NSWindowOcclusionState`) may be
  unreliable for a desktop-level `CanJoinAllSpaces` window. If we can surface a real occlusion state,
  it replaces the proxy and lets us throttle precisely (only when actually covered).
- **SDK `active` signal (build with the SDK).** Expose board activity to widget UIs
  (`useGarret().active` + `onActiveChange`) so widgets pause `rAF`/animations and the SDK's polling
  helpers back off — the renderer half of the same throttle. Not yet plumbed to widget webviews.
- **Verify under load.** The honest stress test: a polling + animating widget, board covered, measured
  with `powermetrics`/Activity Monitor Energy — to confirm the throttle holds where `ps` can't see.

**Tunable:** `IDLE_MULTIPLIER` in `scheduler.ts`. Higher = more battery saved, staler ambient.

---

## Decisions to lock before building the SDK

1. **Renderer primitive (Pillar 3)** — `<webview>` (stay) vs `WebContentsView` (migrate now). *Highest
   cost to reverse; decide first.*
2. **Streaming wire (Pillar 2)** — adopt first-class `stream_*` frames (recommended) + **bridge-level
   backpressure** (recommended) vs document-and-defer.
3. **Host shutdown contract (Pillar 4)** — commit `SIGTERM → onDispose → 3s → SIGKILL` + env scrub as
   core behavior (recommended).

Pillars 1 and 5 are settled. 2 and 4 are "tighten-and-implement." 6 has its core throttle built
(needs the SDK `active` signal + a real occlusion source). 3 is the genuine fork.
