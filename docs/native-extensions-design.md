# Garret Native Extensions — design (rev 2)

> **⚠️ Historical / superseded.** This describes the old **full-access native tier**
> (`garret-native://`, raw-Node host) that has been demolished. The two former widget tiers were
> unified into ONE extension path: `@garretapp/sdk` (package `packages/sdk`), main-side
> `src/main/ext/*`, renderer-side `src/renderer/src/ext/*`, preload `src/preload/extBridge.ts`, the
> single **`garret://`** scheme, renderer prefix `gx:`. The full-access model survives, but tier (web
> vs full-access) is now an internal property **derived** from declared capabilities — not an
> authoring fork. See `docs/architecture.md` (reconciliation banner + old→new file-path map) and
> `docs/garret.html` for the current model.

Status: **design, critic-hardened (2 rounds: security/trust + impl-realism).** Ready to build
the MVP (§10). Rev 1's trust story was theater and its execution model leaned on false
economies ("reuse the bridge", "reuse the window work"); rev 2 fixes both and re-scopes.

## rev 3 delta — Garret is a pure container (raw Node)

Decision refinement: **Garret bakes in NO domain logic** — no `adb`/`scrcpy`, no `garret.devices`
capability. A native extension gets **raw Node** (`require('child_process')`, `fs`, native
modules) and brings *all* its own logic; Garret only provides the runtime. This overrides parts
of rev 2 below:
- **§3 execution model:** not "relaxed webview + main-IPC `garret.process`". Instead the native
  widget runs with **raw Node** — either a `nodeIntegration: true, sandbox: false` `<webview>`
  lane (simplest; verify it's still allowed in Electron 31) or a **Node host process**
  (`utilityProcess`) + a UI webview bridged (robust; needed anyway if nodeIntegration is locked
  down). Garret's only container service here: inject the **resolved login-shell PATH** into the
  widget's env (§5) so its `spawn('adb')` works.
- **§4 capability surface:** raw Node + a *thin* container SDK for convenience only — `storage`,
  `window` (later), and the resolved PATH. **Drop `garret.devices`/`garret.process`** as Garret
  APIs; the widget uses Node directly.
- **§8 device control is a WIDGET, not a Garret capability** — it lives in its **own repo**, uses
  raw Node to run adb/scrcpy, and Garret has zero device code. (The `capability.ts` built earlier
  was reverted for exactly this reason.)
- **§9 native modules** still the open gate for USB/terminal widgets (they'd `require` a `.node`);
  the device widget dodges it (adb/scrcpy are external binaries spawned via `child_process`).
- **Security (§1):** raw Node = the widget can do anything in-process; the §2 Seatbelt profile on
  the widget's Node context becomes *more* important, and nodeIntegration-in-webview means the
  widget shares the renderer — a compromised widget could reach the board. A **Node host process
  under Seatbelt** is the safer raw-Node shape; weigh it against nodeIntegration simplicity.
- **Build order (§10):** step 1 becomes a **nodeIntegration-vs-host-process go/no-go spike**
  (does Electron 31 still allow a raw-Node webview? how isolated?), then the raw-Node lane, then
  the device widget (separate repo).

## 0. Decision

Third-party **native extensions** run with **full system access** (spawn processes, fs, USB,
native modules) so authors can build device control (adb/scrcpy), terminals, USB/memory tools —
things the sandbox forbids by design. Distribution is **sideload / open-ecosystem
(Übersicht-style): anyone builds and shares as source/files; users install by choosing to
trust.** There is **no curated "safe store" for system-access code** — the critics were blunt
that a reviewed registry of full-access extensions is "a signed-malware channel with a warning
label" (review can't catch time-bombs/remote-flags; signing proves author, not safety).

**The sandbox is NOT removed.** It stays as the tier for the *one-click / untrusted* store
(safe, limited widgets). Two tiers, each for what it's good at:
- **Built-in** — first-party, in-process.
- **Sandboxed** — safe/limited; the tier a curated one-click store can use.
- **Native extension** — full access; **sideload + trust only** (this doc).

## 1. Honest security posture (read before anything)

A native extension is **a program the user runs on their Mac** — like a Homebrew formula or a
VS Code extension. There is **no runtime containment beyond §2's OS profile**, and the trust
controls do far less than they appear. State these plainly in UI + docs:
- **Revocation ≠ recall.** It can stop a flagged extension from being *newly installed / first
  loaded*. It **cannot evict** one that already ran — that extension may have persisted outside
  Garret (LaunchAgent), patched Garret, or exfiltrated in its first run. Never call it a "recall".
- **Signing proves author + transit integrity, NOT that the code is safe.** A signed extension
  can be malware. Under native-only there is **no runtime mitigation** for a signed-but-malicious
  or benign-v1→malicious-v2 extension — the sole defenses are *the user chose to trust it*, source
  availability, and author accountability.
- **No permission gate, no network guard.** A native extension calls `require('child_process')` /
  raw sockets directly — the sandbox's `net.ts` SSRF/host-allowlist/rebind protections **do not
  apply**. `garret.*` helpers are *convenience*, never a boundary.
- **TCC inheritance is the sharp edge:** an extension inherits Garret's TCC grants
  (Accessibility from the clipboard feature, Full-Disk, etc.). §2 addresses this.

## 2. Containment we CAN do even in "native" (the cheap real wins)

Native ≠ "no containment." macOS lets us keep ~all capability while removing the worst outcomes:
- **Seatbelt profile (`sandbox-exec`) on the process host.** Spawn the extension's host under a
  profile that **allows** `child_process` + network + the dirs it needs, but **denies** writes to
  `~/Library/LaunchAgents`/`LaunchDaemons`, login items, the Keychain, **Garret's own app
  bundle/asar**, and other extensions' data. This directly blunts the persistence/patching
  attacks that make revocation fiction. Write the profile to cover **descendants** (so a spawned
  `adb` inherits it). `sandbox-exec` is deprecated-but-functional and is exactly the
  "restricted-but-capable" middle we want.
- **TCC separation:** run the extension host as a **separate responsible process** so it does
  *not* silently inherit Garret's Accessibility/Full-Disk grants.
- **Out-of-band process audit:** record the host's descendant process tree (periodic `pgrep`
  of the host pid, or Endpoint Security if we go native) so the "what it spawned" view (§6)
  catches processes launched *bypassing* `garret.process`.
- **Kill-switch ("pause all extensions"):** ship it, honestly scoped as a **stability** control
  (stops runaway/buggy extensions; not a defense against malice that already persisted).
- Per-extension `fs` root: **tidiness, not containment** (label it so).

These are mitigations, not a sandbox. They make the common footguns (persistence, Garret
tampering, silent TCC abuse) meaningfully harder.

## 3. Execution model (corrected — do NOT start with a Node host process)

Rev 1 recommended a per-extension Node host + "reuse the bridge." The impl critic showed both
are wrong: `BridgeHost` **is** the permission gate (strip it → ~40 lines); native needs a
*new* streaming transport (the 256 KB cap + 20 msg/s rate-limit are hostile to `adb`/video
streams); and the current transport is renderer↔webview, not renderer↔child-process. A Node
child also can't render on the single board window.

**MVP model — webview UI + main-process capability IPC:**
- The extension's UI renders in a **webview on the board**, but on a **new relaxed lane** (not
  the `garret-widget://` sandbox lane): its own partition, a relaxed CSP (its own scripts/network
  allowed), a preload that exposes `garret.*`. It is exempt from the global `window.open` deny
  (`index.ts`) and the sandbox CSP.
- Privileged work (`garret.process`, `fs`, device ops) is implemented as **main-process IPC
  handlers** (where `git`/`open` already run — `registerHandlers.ts`), reached via that preload.
  This reuses the app's existing main-process privilege boundary instead of inventing a
  child-process manager + streaming bridge on day one.
- **Defer** the per-extension Node **host process** to when an extension needs long-lived
  native-addon isolation. (When we do add it: `utilityProcess`/`MessagePort`, under the §2
  Seatbelt profile — that host is what gets contained.)

## 4. Capability surface (SDK)

Convenience + consistency, never a boundary:
- **`garret.process`** — spawn/exec with **streaming** stdout/stderr, cancellation, and
  **PATH-correct binary discovery** (§5). Main-IPC-backed for MVP.
- **`garret.fs`** — file helpers over `node:fs`.
- **`garret.devices`** (the reference cap) — list/hotplug Android (`adb`) + iOS (`devicectl`),
  device info, launch/stop mirror.
- **`garret.window`** — floating panels. **Deferred** (§7).
- Plus existing `services`/`fetch`/`storage`/`openExternal`/React; `require(...)` escape hatch.

## 5. Binary discovery (a real gotcha, MVP-blocking)

A GUI-launched `.app` gets a **minimal PATH** (`/usr/bin:/bin:/usr/sbin:/sbin`), **not** the
login-shell PATH — so `adb`/`scrcpy` on `/opt/homebrew/bin` (ARM) or `/usr/local/bin` (Intel)
**won't be found by plain `spawn`** (confirmed: `services/git.ts` works only because `git` is in
`/usr/bin`). Discovery must: (a) resolve the real PATH via a login shell
(`$SHELL -ilc 'echo $PATH'`, cached), and (b) probe a hardcoded dir list incl. the ARM/Intel
Homebrew split, and (c) give a clear "install adb: `brew install …`" UX when missing. Size: **S–M**,
and a **prerequisite** for the device MVP.

## 6. Consent / enable (not a one-time scary string)

- **Install ≠ run.** Per-extension **Enable toggle, default OFF**, persisted. Nothing executes
  until the user deliberately enables it.
- **Descriptive declared actions (declared, NOT enforced):** the manifest declares
  `binaries: ["adb","scrcpy"]`, network, floating-window use; the enable dialog *shows* them —
  "this extension says it runs adb, scrcpy; connects to …". Labeled clearly as *declared, not
  enforced* → informed consent, not theater.
- **Live "what it's running now" panel** (from the §2 process audit): the single highest-value
  cheap win — turns consent from a one-time event into ongoing observability.
- **High-danger classes** (device control): a typed-name confirmation / short cooldown to break
  the click-through reflex.

## 7. Floating windows — DEFERRED (it's the hard problem, relabeled)

`garret.window` (an extension opening/controlling its own `BrowserWindow`) collides head-on with
the single-board-window + native pinning/HUD "single authority" (the isa-swizzle frame fix, the
hud re-pin guard — fragile, hard-won). It's the same **float-over-apps** problem prior work
deferred, now **per-window, per-extension**: level arbitration, full-screen Spaces, click-through
z-order. Honest size **L**, not M. **Out of the MVP** — the scrcpy MVP uses scrcpy's *own* window.

## 8. Reference extension: Device Control (Android-first)

- **List/info/hotplug** connected devices (`adb track-devices`; `adb shell getprop`;
  `devicectl list devices`).
- **Play → scrcpy.** MVP: **`spawn scrcpy -s <serial>` as its own window; track the PID for
  teardown (spawn + kill only)** — Electron *cannot* position/clip/pin another process's SDL
  window, so "manage placement" is cut. Embedded (scrcpy-server → H.264 → WebCodecs in a panel +
  input forwarding) is **XL + a WebCodecs go/no-go spike**, deferred.
- **File explore** via `adb pull/push` + a browser UI.
- **iOS = list/info only** (`devicectl`, needs full Xcode). Apple forbids input injection; screen
  view is heavy (QuickTime protocol) — deferred/likely never.

## 9. Native-module packaging — the OPEN GATE (decide before terminals/USB)

`node-pty` (terminals) and `usb` are **per-ABI compiled `.node` addons**. The `.garret` pipeline
**rejects binaries** (`ALLOWED_EXT` in `unpack.ts`/`install.ts`) with 20 MB/200-file caps, ABI is
pinned to Electron 31.7.7/arm64, the app can't rebuild, and the org blocks install scripts → **as
of today a terminal/USB extension is unbuildable.** Three futures, each with a cost:
1. **Host-bundles** `node-pty`/`usb` behind `garret.*` (kills the raw native-`require` escape).
2. **Author ships per-ABI prebuilds** (author burden; app must publish its exact ABI as contract;
   package format + allowlist + caps must grow a `.node` path with integrity hashing).
3. **PATH-binaries only** (no native addons; kills terminal-via-pty / USB-via-addon).
**MVP uses (3) implicitly** — `adb`/`scrcpy` are external binaries, no `.node` — so the MVP dodges
this. Decide 1 vs 2 before promising terminals/USB.

## 10. Build order (re-estimated) + smallest MVP

Rev 1's item 1 ("host + bridge + discovery = L") was really XL/three things. Split + re-scoped:

| # | Slice | Size | Notes |
|---|---|---|---|
| **MVP-a** | **Binary discovery** (login-shell PATH + probe + "install" UX), main-IPC | **S–M** | §5; prerequisite |
| **MVP-b** | **`garret.process` main-IPC** (spawn/exec, streaming, cancel) | **M** | reuses main IPC, not a new bridge |
| **MVP-c** | **Relaxed webview lane** (partition/CSP/preload for a native extension) + enable-toggle consent | **M** | §3, §6 |
| **MVP-d** | **Device Control extension** (sideloaded): list/info/hotplug + launch scrcpy (spawn/kill) + basic file list | **L** | §8, Android-first |
| — later — | Seatbelt profile + TCC-separate host | M | §2 — add before wider sideloading |
| — later — | `garret.window` floating panels | L | §7 |
| — later — | Embedded scrcpy stream (+ WebCodecs spike) | XL | §8 |
| — later — | native-module packaging decision → terminals/USB | M+ | §9 |

**Smallest honest first slice = MVP-a + MVP-b:** main-process, headless-testable —
"discover `adb`/`scrcpy`; run `adb devices` + `getprop`; spawn/kill `scrcpy`." No UI lane, no
extension, no landmines. Prove the capability backend, then wire the webview lane + the extension.

## 11. Open questions
- Native-module packaging: host-bundle vs per-ABI prebuilds (§9) — before terminals/USB.
- Seatbelt profile scope: exact allow/deny set + descendant coverage; does it break `adb`'s
  daemon? Ship the MVP without it, add before sideloading beyond self.
- Relaxed webview lane vs. a later `utilityProcess` host — when does an extension actually need
  the host process?
- Embedded-scrcpy WebCodecs availability in this Electron (go/no-go spike).

## 12. References
- Superseded/kept-for-store: `src/renderer/src/sandbox/*`, `src/main/sandbox/*`, `docs/sandbox-design.md`.
- Main-process capability precedent: `src/main/services/git.ts`, `src/main/ipc/registerHandlers.ts`.
- Windowing authority (why §7 is L): `native/mac_window.mm`, `src/main/windows/createWindow.ts`.
- Signing (if ever pursued for a *sandboxed* store): `docs/marketplace-design.md`.
