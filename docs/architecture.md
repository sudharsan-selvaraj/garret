# Garret — core architecture (the five pillars)

The foundations everything else sits on, ordered by **how expensive they are to change later**.
The top ones will break the SDK, the security model, and the UX if they're wrong early. This doc is
the authoritative status of each: what it is, what we've actually built (with file references), and
the decisions still open before the `garret` SDK (`docs/garret.html`) freezes the contracts.

> Companion docs: `docs/garret.html` (unified product + SDK authoring guide + this architecture,
> rendered), `docs/native-ext-sdk-design.md` (SDK design, rev 2, critic-hardened),
> `docs/native-phase3-design.md` (install/consent), `docs/native-ext-dx-review.md` (P1–P10),
> `docs/sandbox-design.md` (web tier). This markdown file is the authoritative engineering reference;
> `garret.html` mirrors its content for reading.

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

## 7. Cross-platform (future) — macOS-only today

Garret is **macOS-only** right now (native `mac_window.mm`, `safeStorage`, Homebrew-only binary
hints). An external audit mapped what changes per-OS; captured here as the roadmap, not a
commitment. The core divergence is **the desktop layer** (Pillar 1) — every OS needs a different
trick, and one (Wayland/GNOME) has no clean path yet.

| Feature | macOS | Windows | Linux X11 | Linux Wayland |
|---|---|---|---|---|
| Ambient desktop layer | ✅ native (addon) | 🟡 WorkerW re-parent | 🟡 `_NET_WM_WINDOW_TYPE_DESKTOP` | ❌ compositor-specific (`wlr-layer-shell` only) |
| HUD (above all) | ✅ screen-saver lvl | ✅ `setAlwaysOnTop` | ✅ `_NET_WM_STATE_ABOVE` | 🟡 `wlr-layer-shell` |
| Overlay on full-screen | ✅ `visibleOnFullScreen` | ❌ full-screen owns display | 🟡 compositor-dep | 🟡 layer-shell only |
| Secrets | ✅ `safeStorage` | ✅ `safeStorage`/DPAPI | 🟡 libsecret (needs daemon) | 🟡 same |
| Native host process | ✅ | ✅ | ✅ | ✅ |
| Binary resolve hints | ✅ Homebrew | 🟡 Scoop/Choco/WinGet | ✅ apt/dnf | ✅ same |

**Design implication (adopt when we go cross-platform):** a single `GarretPlatform` interface
(`window.sinkToDesktop/raiseToHUD` + `supportsDesktopLayer`/`supportsFullscreenOverlay` feature
flags, `secrets`, `binary.resolve` with a per-OS probe+hint table, `autostart`, `tray`) with one
impl per OS — so cross-platform is *one new implementation*, not scattered `process.platform`
checks. `resolveBinary` must carry a **per-OS install-hint table** (the `brew install …` hint is
wrong everywhere else). Suggested order: **macOS (now) → Windows (WorkerW) → Linux X11 → Wayland
(post-1.0)**.

---

## Audit adjudication (July 2026)

An external architecture/SDK audit (27 findings) was reviewed against the code. Nothing dismissed
blindly — verdict + grounding for each:

| Finding | Verdict | Grounding |
|---|---|---|
| ARCH-01 renderer isolation (`<webview>`→`WebContentsView`) | **Valid** = open Pillar 3 | We do use `<webview>`. But its CSP-bypass critique doesn't apply: enforcement is already **session-level per-partition** (`sandbox/session.ts`), not attribute-CSP. `WebContentsView` still the modern path. |
| ARCH-02 define IPC wire / first-class `stream_*` frames | **Valid** — already §2 | Structured clone + per-instance ids already true; adopt `stream_*` frames before the SDK. |
| ARCH-03 enforce capabilities in main | **Valid, already done** | `session.ts` (main) `onBeforeRequest`/permission-deny + Phase-3 **HMAC-signed consent, re-consent on change**. Fully satisfied. |
| ARCH-04 `fork` vs `spawn` | **Partial** | We use `utilityProcess.fork` (Electron-native, defensibly better than `child_process.fork`). ready-timeout/stderr/crash-surface done; **env-scrub + graceful-shutdown are the §4 gaps.** |
| ARCH-05 window level + Mission Control | **Mostly already done** | `mac_window.mm` already sets `CanJoinAllSpaces\|Stationary\|IgnoresCycle` + non-activating panel + `visibleOnFullScreen`. Residual nuance: HUD uses **screen-saver** level (above Notification/Control Center) — test `floating` (§1). |
| ARCH-06 tier-inference contradiction | **Valid — adopt** | Real doc contradiction. Resolution below (require both). |
| SDK-01 `@garret/sdk` scoped package | Adopt | matches §14 Q1. |
| SDK-02 sibling calls via **function declarations** | Adopt (supersedes rev-2 `methods` arg) | hoisted fn decls cross-reference safely — simpler, removes SDK surface. |
| SDK-03 `ctx.spawn` array-only + `spawnShell` opt-in | Adopt | string form is a shell-injection surface even in a trusted ext. |
| SDK-04 `useConfig` → `patchCfg` (merge) + `setCfg` (replace) | Adopt | current single-key `setCfg` on a multi-key type is ambiguous. |
| SDK-05 `useStream` React hook | Adopt | removes the manual `useEffect`+cancel leak. |
| SDK-06 `g.instanceStorage` (per-placement) | Adopt | key-level merge doesn't stop **same-key cross-instance clobber**; per-instance namespace does. |
| SDK-07 typed `g.service<T>()` | Adopt | generic response type now; typed clients (`@garret/sdk/services`) later. |
| SDK-08 doc fixes | Valid — confirmed | gotchas table **skips P8** (P1–P7,P9,P10); config x-ref says **§07 but is §08**; `garret/ui`/`defineManifest`/`g.window` need examples. |
| Q1–Q8 open questions | Resolved | Q1 `@garret/sdk` · Q2 `garret.manifest.json` · Q3 require-both · Q4 React+`/ui` only · Q5 keep `Stream<C,R>` (default `void`) · Q6 mini-schema + `defineConfig()` · Q7 compat shim (sunset 6mo) · Q8 no web-tier host. |
| OS-01 desktop layer cross-platform | Valid — future | §7 above. |
| OS-02 secrets cross-platform | Partial | already on `safeStorage` (cross-platform); residual = **Linux no-daemon → `UNAVAILABLE`**, not a crash. |
| OS-03 `resolveBinary` per-OS probe+hints | Valid — future | not built yet; design cross-platform from the start (§7). |
| OS-04 native addon per-platform builds | Valid — future | matches the deferred `.node` gate. |
| OS-05 `GarretPlatform` abstraction | Valid — adopt when cross-platform | §7. |

---

## Decisions to lock before building the SDK

1. **Renderer primitive (Pillar 3)** — `<webview>` (stay) vs `WebContentsView` (migrate now). *Highest
   cost to reverse; decide first.*
2. **Streaming wire (Pillar 2)** — adopt first-class `stream_*` frames (recommended) + **bridge-level
   backpressure** (recommended) vs document-and-defer.
3. **Host shutdown contract (Pillar 4)** — commit `SIGTERM → onDispose → 3s → SIGKILL` + env scrub as
   core behavior (recommended).
4. **Tier inference (ARCH-06) — RESOLVED: require BOTH.** The `host` entry is the *runtime* signal
   (spawn a child?) and explicit system capabilities are the *consent* signal (what to tell the
   user). A full-access tier requires **both** a `host` entry **and** ≥1 system capability
   (`process`/`fs`/`native`/`network:*`); reject at install otherwise (`host` with no system cap →
   "requires a capability"; a system cap with no `host` → "requires a host entry"). This is the only
   model where the consent screen is accurate.

Pillars 1 and 5 are settled. 2 and 4 are "tighten-and-implement." 6 has its core throttle built
(needs the SDK `active` signal + a real occlusion source). 3 is the genuine fork. Cross-platform
(§7) is future. Tier inference (#4) is resolved.

---

## Pre-SDK resolutions (contract review)

A second review flagged 10 contracts that must be settled before SDK code. Decision + grounding for
each. **Blocking** = the SDK surface depends on it; **Author-facing** = must exist before external
authors touch it; **Defer-OK** = decided now, can be built later.

### 1. Action palettes — SDK scope *(blocking)*
Of the three product modes, **Ambient and HUD are the same board widget** (HUD is the board *raised*;
a widget never declares which — it's a global mode). Only **Palette** is a distinct surface: today
those are **first-party separate `BrowserWindow`s** (`clipboardPicker.ts` — global-shortcut summon,
blur-dismiss). **Decision: v1 SDK ships board widgets only; third-party palettes are deferred.** When
added, a palette declares `"surface": "palette"` (default `"board"`); the **user owns the shortcut**
(the manifest may *suggest* one, rebindable in Settings); palette size is a compact fixed contract,
not the board grid; and its lifecycle is ephemeral — **`ctx.onDispose` fires on uninstall/host-kill
only**, while summon/dismiss surface through the `active` signal (§4) / an `onShow`/`onHide`. Rationale:
palettes need window-level + global-shortcut + focus semantics that board widgets don't have; a half
version now would distort the authoring model. The board contract ships first; palette is purely
additive.

### 2. Pillar 3 renderer primitive — DECISION: stay on `<webview>` for v1, behind a surface abstraction *(blocking — resolved)*
The spike measured the `WebContentsView` geometry-sync cost as M–L (happy path small; cost in scroll
+ DPI/multi-monitor). Weighed against a **marginal** isolation gain (our boundary is already
main-enforced: per-partition session + CSP + `contextIsolation` + `sandbox`), the DOM-element layout
of `<webview>` is worth keeping for v1. **The key move that unblocks the SDK: the SDK's widget
lifecycle (`onMount`/`onResize`/`onVisibilityChange`) is defined _primitive-agnostically_ — a
`WidgetSurface` abstraction (already effectively `NativeWidget`/`SandboxWidget`) is the only thing
that touches the primitive.** So the render contract the SDK freezes is the abstraction, not
`<webview>`; a later `WebContentsView` migration becomes an internal change, not an SDK break. This
neutralizes "hardest to change." **Revisit trigger:** Electron hard-deprecates `webviewTag`, or we
need materially better crash-isolation/perf than webview gives.

### 3. Widget crash isolation — contract *(blocking; mostly built)*
**Built:** `WidgetErrorBoundary` wraps every widget in `WidgetHost` — a React throw shows a
per-widget "failed to render" + Retry, isolated; other widgets are unaffected. **Gap:** a webview
*guest* process crash (`render-process-gone`) or `did-fail-load` currently blanks that webview
silently. **Plan:** add `render-process-gone`/`unresponsive`/`did-fail-load` handlers per widget
webview → same widget-level crashed state + Retry (reloads the guest). **SDK contract to document:**
"Garret catches (a) React render errors in your UI and (b) a crashed/unresponsive webview — both
become an isolated widget-level crashed state with Retry. You do NOT need a top-level boundary; you
DO handle your own async/promise rejections."

### 4. `g.active` — the polling contract *(blocking)*
Host-side throttle exists (`setBoardActive`, §6). Define the **UI-side** contract and build the pipe:
`useGarret().active: boolean` + `useActive()` hook + `onActiveChange`. Semantics: `true` when the
board is HUD/focused, `false` when ambient/idle. **Contract:** "polling / `rAF` / animation SHOULD
pause or throttle when `!active`. The SDK's polling helpers (`useHostQuery`, `useStream` with a
`pollMs`) do this for you; if you hand-roll `setInterval`/`rAF`, gate it on `active`." Plumbing: main
broadcasts board-active to each widget webview; preload exposes it; SDK wraps. v1 SDK deliverable.

### 5. `.garret` file format + signing model — DEFINE *(author-facing; grounded in code)*
**Format:** a **ZIP** (`unpack.ts` via `yauzl`, slip-safe). Layout: `garret.manifest.json` at root +
`ui/` (+ `host/` for native) + assets. **Install validation:** slip-safe extraction (reject `..` /
absolute / symlink / backslash names), manifest parse + tier check (§decision 4), containment on the
`node`/`ui` paths, native rejects `.node`, size/file caps. **Signing (state this plainly):** the
`.garret` is **NOT author-signed** — Garret is sideload/trust (no curated store; author signing would
be signed-malware theater, per the native design). Integrity is a **local** mechanism: on install
Garret writes a record (`.garret-ext.json`) **HMAC-signed with a per-app key in `safeStorage`**,
committing to `sha256(all files) + id + version + enabled`. That stops **local tampering** (forging
`enabled:true`, swapping files) — it is **not** author authentication. Docs must not imply `.garret`
files are trusted/signed.

### 6. Extension updates — DEFINE *(author-facing)*
- **Discovery:** v1 is **manual re-install** (drop a newer `.garret`) — sideload, no registry. Registry/auto-update is post-1.0.
- **Consent on update:** installing over an existing id detects the prior record; **any code change (sha delta) or added capability resets `enabled:false` and re-consents BEFORE the new code runs** (already how native `commitInstall` behaves). The update lands *disabled*; it only runs after re-consent.
- **Data:** `storage`/`secrets` live in a separate per-extension data dir, **untouched by re-install** (preserved). Schema migration is the **author's** job — expose the prior version to the host via a one-time **`onUpgrade(fromVersion)`** hook (define it).
- **Rollback:** install is **atomic** (temp + rename), so a crash *mid-install* leaves the old version intact. No auto-rollback on *post-install* crash — the crash surfaces (§3) and the user disables / re-installs the prior `.garret`. v1-acceptable.

### 7. Dev loop — DEFINE *(author-facing; partly exists)*
**Have:** electron-vite HMR (renderer), host = `utilityProcess` with stderr piped `[ext:<id>]`, dev
auto-DevTools for `garret-native://` webviews. **Target for authors (`@garret/create-ext` + `garret
dev`):** watch-build UI (vite) + host (esbuild) → a dev Garret loads `dist/`. **UI-only hot-reload**
reloads the widget webview without restarting the host; **host-only reload** re-forks just that
extension's host (UI stays, reconnects) — the two are independent. **Logs:** host stderr surfaced in
the widget's DevTools console *and* the terminal, prefixed. **Debugger:** `garret dev --inspect-host`
forks the host with `--inspect` for chrome://inspect / VS Code attach. v1 SDK deliverable.

### 8. Multi-monitor (macOS) — DECISION: one **spanning** board across all displays for v1
Primary-only was a weak call for a multi-monitor audience. **v1 = a single board window sized to the
union of `screen.getAllDisplays()` bounds**, giving **one global grid / one coordinate space** —
widgets placeable on any display. This is the smallest change from today (`getPrimaryDisplay().bounds`
→ union) and keeps the layout contract the SDK freezes trivial (global x/y). The native desktop pin +
`CanJoinAllSpaces` already apply to the one window regardless of size.

**v1 work beyond the union bounds:** a `screen` change listener (`display-added`/`removed`/`metrics-
changed`) that re-fits the board to the new union and **clamps orphaned widgets** (on a
now-disconnected display) back on-screen. **Known caveats (acceptable):** display *gaps* in the union
rect are dead zones (harmless — click-through, nothing there); mixed-DPI displays are OS-scaled from
the window's primary scale (may look marginally soft on a differently-scaled secondary). **Deferred
(additive, not a contract change):** true **per-display boards** (respecting each display's exact
scale + no dead zones) — the heavier model Windows' WorkerW forces (§7); each per-display board is
just another instance of the same grid, so switching later doesn't move the coordinate contract.

### 9. `g.service` connection model — DEFINE *(author-facing; built)*
**Grounded:** services are **first-party connectors** (Google/Jira/GitHub) with OAuth
(`googleOAuth.ts`, loopback+PKCE, refresh token encrypted in `safeStorage`) + `serviceConnect/
Disconnect/Status` IPC + a Settings UI. **Model:** Garret ships the connectors; the **user** connects
an account in Settings; a widget declaring `service:github` gets `g.service('github').connected` +
`.query()` **brokered by main — the widget never sees the token**; revoke = Settings → disconnect.
So the SDK surface has a real backing today (`getService(id).status/query`). v1: expose existing
connectors to widgets; new connectors are first-party additions. Author-provided OAuth apps = future.

### 10. `window` capability inconsistency — FIX: reject at install *(cleanup)*
`window`/`g.window` is deferred/unimplemented but was still declarable — a trap. **Decision: the
manifest validator rejects any capability not in the *implemented* set**, so `"capabilities":
["window"]` is rejected at install with "not yet implemented," not silently accepted. Remove `window`
from the advertised capability list until it ships (keep it in the roadmap). Document the implemented
set explicitly.

**Net:** blocking items 1–4 are decided (palette scoped out; webview + surface abstraction; crash
contract; `g.active`). Author-facing 5–7 and 9 are defined (grounded in existing code). 8 and 10 are
decided. Nothing here should surprise an SDK author after the fact.
