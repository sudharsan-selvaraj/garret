# Phase 3 — Sandbox Host (design, rev 4)

Run third-party widgets in an **out-of-process, isolated `<webview>`** that talks to the
host only over a permission-enforced bridge implementing `GarretClient`. Secrets never
cross; a misbehaving widget is killable without touching the host. The **entry ticket to
distribution**.

> rev 2 = round-1 review (webview over iframe; custom protocol + header CSP; two-layer
> network enforcement). rev 3 = round-2 review (privileged-scheme pre-registration,
> session-guards-before-navigation, bridge-preload IPC constraint, rate-limit/validation/
> openExternal-dialog/webview-cap/host-CSP). rev 4 = round-3 review: the **precise DNS-rebind
> mechanism** (explicit `dns.lookup` in the connector + complete blocked-IP set incl.
> IPv4-mapped/NAT64/`0.0.0.0`/`::1`), the `ipcMain`-sender accepted-risk + `e.sender` guard,
> and an explicit build-time-verify checklist.

## 1. Threat model

A third-party widget is **untrusted code**. Contain (browser-extension-shaped):

- **MUST NOT** reach: host DOM/React, host globals (`window.garret`, ipc, node), other
  widgets' DOM/data/storage, the filesystem, secrets/tokens, host cookies/localStorage.
- **MUST NOT** do I/O except through the bridge: no direct network (fetch/XHR/WS/WebRTC),
  navigation, popups, workers, or `eval` reaching anything.
- **MUST NOT** hang or crash the host (process isolation + kill).
- **MAY** (only via bridge, only if declared): `services.query`/`status` for a named
  service, `fetch` to a declared host, per-widget `storage`, file `watch`, `openExternal`
  (with confirm). **NOT** `services.connect`/`disconnect`.
- **Accepted, documented** (§10): a widget burning its own process's CPU; misleading UI in
  its own box; poll-key existence as a metadata side-channel.

Trust ↓likelihood (provenance, Phase 4); isolation ↓impact (this phase). Layered.

## 2. Architecture

```
┌─ host renderer (trusted, strict CSP) ─────────────────────────────────────┐
│  WidgetHost → SandboxWidget (per external widget)                          │
│   1. session.fromPartition('garret-widget-<id>') → install guards          │
│      (WebRTC off, webRequest scheme filter, deny permissions) BEFORE nav    │
│   2. <webview src="garret-widget://<id>/" partition=… preload=bridge-preload│
│            webpreferences="contextIsolation,sandbox,nodeIntegration=no">    │
│   3. BridgeHost: validate → rate-limit → ENFORCE PERMISSIONS → window.garret.*│
│              ▲ ipc-message / .send()  (webview host↔guest channel)         │
│  ┌─ webview guest = SEPARATE PROCESS, origin garret-widget://<id> ────────┐│
│  │  bridge-preload (host, sandboxed): contextBridge → __garretBridge        ││
│  │     (uses ONLY ipcRenderer.sendToHost / .on — never invoke/send)         ││
│  │  bundle.js = author code + their React + garret-widget-sdk/sandbox        ││
│  │     runWidget(): bridgeClient → createSDK(React, bridgeClient) → mount    ││
│  └──────────────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────────┘
   window.garret.* → main: credentials/HTTP/fs + a MAIN-layer network gate (resolved-IP)
```

Enforcement is **two-layer**: renderer `BridgeHost` (primary) + a main-process re-check on
`fetch` (defense against a renderer bug). Main never returns secrets.

## 3. Isolation

**`<webview>` (OOPIF) served from a privileged custom protocol with a header CSP.**

- **Privileged scheme — MUST pre-register (rev 3):** at main module load, *before*
  `app.whenReady()`:
  ```ts
  protocol.registerSchemesAsPrivileged([{ scheme: 'garret-widget',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }])
  ```
  Without `standard:true` the scheme has an **opaque origin** → `script-src 'self'` matches
  nothing (bundle won't load) and the CSP may be ignored — a silent total failure.
  `secure:true` gives a secure context (so `crypto.randomUUID` etc. work). After ready,
  serve via `protocol.handle('garret-widget', …)` (Electron ≥25) returning the bootstrap
  HTML + `bundle.js` **with the CSP response header** (not `<meta>`). Origin per widget is
  `garret-widget://<id>` → cross-widget isolation.
- **Process isolation:** a `<webview>` runs in its own renderer process; a `while(true)`
  hangs only that process. Host recovers via `render-process-gone` + `webContents.destroy()`.
- **webview attributes:** `partition="garret-widget-<id>"` (non-persistent), `preload`
  (host bridge-preload only), `webpreferences="contextIsolation=yes,sandbox=yes,
  nodeIntegration=no,webSecurity=yes"`. `allowpopups` NOT set.
- **CSP header (complete):** `default-src 'none'; script-src 'self'; style-src
  'unsafe-inline'; img-src 'none'; media-src 'none'; font-src 'none'; connect-src 'none';
  frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none';
  form-action 'none'; frame-ancestors 'none'`. No `unsafe-eval` ⇒ widget bundles must be
  **pre-built (no runtime `eval`/`new Function`)** — an authoring constraint.
- **Session guards (rev 3: installed BEFORE the webview navigates):** `SandboxWidget`
  resolves `session.fromPartition('garret-widget-<id>')` and, **synchronously before
  setting `src`**, installs: `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')`,
  `setPermissionRequestHandler(()=>false)` + `setPermissionCheckHandler(()=>false)`, and
  `webRequest.onBeforeRequest` cancelling any request whose scheme ≠ `garret-widget:` (so
  even a CSP miss can't reach the network). Doing this post-navigation would leave the
  first load unguarded.

## 4. The bridge (transport)

Webview host↔guest IPC (no MessageChannel port → no port-delivery race):
- **Guest→host:** `bridge-preload` → `ipcRenderer.sendToHost('garret:msg', m)`; host listens
  on `webview.addEventListener('ipc-message', …)`.
- **Host→guest:** `webview.send('garret:msg', m)`; preload `ipcRenderer.on('garret:msg', …)`.
- **bridge-preload HARD CONSTRAINTS (rev 3):** it is the entire guest-side trust boundary.
  It MUST use **only** `ipcRenderer.sendToHost` and `ipcRenderer.on('garret:msg')`. It MUST
  NOT call `ipcRenderer.invoke`/`send` (those reach `ipcMain` directly, bypassing the
  BridgeHost — and host channels have no sender check). Enforced by an ESLint rule
  (`no-restricted-properties` on `ipcRenderer.invoke`/`send` in the preload). It exposes a
  thin `__garretBridge` (`post(msg)`, `onMessage(cb)`) via `contextBridge` — no privileged
  capability, just transport. Packaged: the preload is `asarUnpack`-ed and referenced by an
  absolute path from `app.getAppPath()`; startup asserts the file exists.
- **Handshake:** host waits for the guest's `{kind:'ready'}` before sending
  `{kind:'init', config, instanceId, refreshToken}`. Deterministic.
- **Request/response:** `{id, kind:'call', method, args}` → `{id, kind:'result'|'error',
  value}`. `id` = `crypto.randomUUID()` (secure context). Map<id,{resolve,reject}>. Only
  structured-clone data crosses.
- **Subscriptions:** local callbacks + `{kind:'subscribe', topic}` (topic = `poll:<key>` |
  `watch:<watchId>`); host pushes `{kind:'event', topic, payload}`; `unsubscribe` on
  teardown. Topic namespacing prevents poll/watch cross-talk.

## 5. bridgeClient + bootstrap (`garret-widget-sdk/sandbox`)

`runWidget(plugin)`: build `bridgeClient: GarretClient` over `__garretBridge` →
`createSDK(React, bridgeClient)` (**unchanged createSDK**) → on `init` build `ctx` (storage
→ `bridgeClient.storage`; `updateConfig` → bridge; `refreshToken`) → mount
`plugin.render({config, ctx, sdk})`. Author bundles their React + this bootstrap + widget
into `bundle.js`.

## 6. Permission enforcement (two layers)

`manifest.permissions: string[]` → matcher. **Every** call checked in `BridgeHost` before
dispatch via an **explicit method allowlist** (never dynamic `window.garret[method]`);
scoping applied at dispatch regardless of widget input. Undeclared → `error` + recorded.

| Call | Permission | Rule |
|---|---|---|
| `services.query/status(id,…)` | `service:<id>` | exact id; **`connect`/`disconnect` HARD-BLOCKED** (host-UI only) |
| `poll.subscribe(subId,key,serviceId,…)` | `service:<serviceId>` | BridgeHost reads `serviceId` arg, checks at subscribe |
| `fetch(url,…)` | `network:<host>` | `hostname===s || hostname.endsWith('.'+s)` (never `includes`); port compared; see redirects + rebind |
| `watch.*` | `files:read` | v1 gated + watched paths recorded to a persistent per-widget log; `files:read:<prefix>` scoping = Phase 4 |
| `storage.*` | always | BridgeHost prepends `<widgetId>\0` before `window.garret.store.*`; per-widget partition adds a 2nd layer |
| `openExternal(url)` | `openExternal` | **new `pluginsOpenExternal` channel** that calls `dialog.showMessageBox` (confirm) every time — NOT the existing fire-and-forget `openExternal` |

- **Network: redirects + DNS rebinding (rev 4, closed precisely):** `fetch` →
  `window.garret.plugins.fetch(url, init, {allowedHosts})`. The **main** handler:
  - (a) scheme http/https only; reject literal private-IP *hostnames* (canonicalized) at
    manifest-load AND request time.
  - (b) **SSRF/rebind close — the real mechanism:** a custom undici `Agent` whose connector
    does its **own `dns.lookup(hostname,{all:true})` and rejects if ANY returned address is
    in the blocked set, BEFORE opening the socket.** (undici's `connect` is handed the
    *hostname*, not the resolved IP — so we resolve explicitly and never trust a
    request-time hostname check.) **Blocked set, canonicalized, both families:** IPv4
    `0.0.0.0/8`, `10/8`, `100.64/10` (CGNAT), `127/8`, `169.254/16`, `172.16/12`,
    `192.168/16`; IPv6 `::1`,
    `fe80::/10` (link-local), `fc00::/7` (ULA), IPv4-mapped `::ffff:0:0/96` (extract +
    re-check the embedded v4), NAT64 `64:ff9b::/96` (extract + re-check embedded v4).
  - (c) `redirect:'manual'`; for each `Location` (≤5 hops) re-check the host against
    `allowedHosts` AND re-run (b). The **same Agent is threaded through every hop** — losing
    it on a redirect fetch silently removes rebind protection.
  - Dev trusted-local tier keeps the 2-arg call (unrestricted, dev only).
- **Message validation (rev 3, concrete):** host rejects any message where `kind ∉
  {ready,call,subscribe,unsubscribe}`, `method ∉ allowlist`, `args` not an array, total
  serialized size > 256 KB, or any string field > 64 KB.
- **Rate limit (rev 3, concrete):** per-widget token bucket — 50 calls burst, refill 20/s;
  over-budget calls get `error:'rate limited'` (not queued). Subscriptions counted once.
- **Usage tracking (disclosure):** BridgeHost records invoked + denied-undeclared
  capabilities → Phase-4 consent diff. No safe/unsafe verdict.
- **apiVersion:** host checks major vs `SUPPORTED_API_VERSION`; incompatible → refuse load.

## 7. Host integration

- Registry marks **built-in** (in-process `Render`) vs **sandboxed** (`SandboxWidget` →
  webview). `SandboxWidget` lifecycle order: (1) configure partition session guards →
  (2) create webview + set `src` → (3) attach `ipc-message` BridgeHost → (4) on `ready`,
  send `init`. Reuses native outer chrome; only the body is the webview.
- Trusted-local `new Function` tier stays **dev-only** (packaged-gated off).
- **Host-renderer message audit (rev 3, mechanized):** the bridge uses webview
  `ipc-message`, not `window.postMessage`. An ESLint rule forbids
  `window.addEventListener('message', …)` in host renderer code so a future addition can't
  silently become a bypass.

## 8. Lifecycle, teardown & limits

- One partition/session/BridgeHost/bridgeClient/sdk per webview **load**.
- BridgeHost tracks each poll/watch subscription as calls arrive (a Set); teardown
  unsubscribes all, destroys the WebContents, clears the non-persistent partition. No
  dangling subscriptions/processes.
- Config/size changes post a message (no reload).
- **Webview cap (rev 3):** each webview is its own OS process (~50–100 MB). v1 caps
  **simultaneously-live sandboxed webviews** (default 6); widgets beyond the cap (or
  off-screen) render a lightweight placeholder and instantiate their webview on
  view/interaction. Documented constraint, tunable.

## 9. Failure modes

- **Crash/loop:** contained in the widget process; host shows "widget crashed — reload";
  can `destroy()`.
- **Bridge abuse:** message validation + token-bucket rate limit + size cap (§6).
- **Malformed:** shape-validated; junk ignored.

## 10. Accepted risks (documented)

- A widget spinning its own process's CPU (isolated; killable).
- Misleading UI inside its own box (can't escape it).
- Two widgets on the same poll `key` can infer each other's query existence (metadata).
- `files:read` not path-scoped in v1 (gated + watched-paths logged; `files:read:<prefix>`
  next).
- `img-src 'none'` default; enabling images later reintroduces a data:-URI channel.
- `ipcMain` handlers trust the host renderer (no per-sender capability tokens), so a
  *compromised host renderer* could call `pluginsFetch` with arbitrary `allowedHosts`.
  Mitigated by: the host renderer being trusted first-party code under a strict CSP, the
  main-layer resolved-IP check (which holds regardless of `allowedHosts`), and a cheap
  `pluginsFetch` guard that verifies `e.sender` is the main board WebContents. Full
  per-widget capability tokens in main are future hardening.

## 11. Host CSP — a PREREQUISITE (rev 3)

`webviewTag:true` is a renderer-wide grant, so the **host renderer CSP must be locked down
before the sandbox ships** (ordering requirement, not afterthought): set via main
`session.onHeadersReceived` — `default-src 'self'; script-src 'self'; frame-src
garret-widget:; object-src 'none'`, no `unsafe-eval` in production. External code no longer
runs in the host realm (dev `new Function` tier packaged-gated off), so this is now safe.
Verify the dev tier still works in dev only.

## 12. NOT in Phase 3 (→ Phase 4)

Install lifecycle (fetch/verify/install/update/remove to `userData/widgets`), consent-screen
UX, provenance/signing/integrity, re-consent on permission change, marketplace, author
scaffold/build preset, `files:read:<prefix>` grammar. Phase 3 = runtime + isolation +
enforcement, end-to-end testable with a locally-staged sample widget.

## 13. Decisions (all open questions closed)

1. **DoS** → `<webview>` OOPIF + killable.
2. **srcdoc vs protocol** → privileged custom `garret-widget://` protocol + header CSP.
3. **webview vs iframe** → webview (process isolation, partition, host preload).
4. **Permission grammar** → `service:<id>`, `network:<host>` (`*.suffix` via endsWith;
   private IPs rejected at declare-time AND resolve-time), `files:read`, `storage`,
   `openExternal` (confirm dialog). `clipboard:*` not bridged in v1.
5. **services.connect** → No; `connect`/`disconnect` hard-blocked for sandboxed widgets.

## 14. Build plan + acceptance tests

Build order: (1) privileged-scheme registration + `garret-widget` protocol handler (CSP
header). (2) `bridge-preload` (sendToHost-only; lint-enforced) + `garret-widget-sdk/sandbox`
`runWidget`/bridgeClient. (3) main `pluginsFetch` upgrade: `allowedHosts` + manual-redirect
re-validation + **resolved-IP private-range reject** (custom dispatcher). (4) new
`pluginsOpenExternal` channel with confirm dialog. (5) renderer `BridgeHost` (method
allowlist, matcher, subscription tracking, storage namespacing, rate limit, message
validation). (6) `SandboxWidget` (session-guards-before-nav, webview, lifecycle, cap).
(7) host renderer CSP lockdown + ESLint rules (preload `ipcRenderer.invoke/send`; host
`window` message listener).

**Acceptance tests (must all pass before "done"):**
- Guest DevTools: `window.__garretBridge` exists; `window.ipcRenderer` is `undefined`;
  document origin is `garret-widget://<id>` (not opaque/null); CSP response header present.
- `new RTCPeerConnection(...)` yields no private-IP candidates.
- Permitted `fetch` works; **undeclared host denied**; **302→undeclared host blocked at
  main**; **302→private-IP blocked**; rebind blocked at connect for a host resolving to
  each of: `192.168.x.x`, `::ffff:192.168.1.1` (IPv4-mapped), `64:ff9b::192.168.1.1`
  (NAT64), `0.0.0.0`, `::1`, `169.254.x.x`.
- `services.connect` from a widget is refused; `openExternal` shows a confirm dialog.
- storage round-trips and is invisible to a second widget.
- a `while(true)` widget is killed without hanging the board; teardown leaves zero host
  subscriptions and zero leaked processes.
- dev `new Function` tier still works in dev, is absent in a packaged build.

**Build-time-verify checklist (correct in design — confirm in code):**
1. `registerSchemesAsPrivileged` runs at module top level, *before* `app.whenReady()`.
2. `SandboxWidget` installs the partition session guards *before* `webview.src` is set
   (render gated on `guardsReady`, or set `src` imperatively after guards).
3. bridge-preload is one thin file, no transitive imports; uses only `sendToHost`/`.on`.
4. the `no-restricted-properties` ESLint rule (preload `ipcRenderer.invoke`/`send`) is
   file-scoped (the host renderer legitimately uses `invoke`).
5. the custom undici Agent is passed to *every* redirect hop.
6. `pluginsOpenExternal` is `ipcMain.handle` (returns the dialog result); the old
   fire-and-forget `Channels.openExternal` is unreachable from widgets.
7. host-renderer CSP `onHeadersReceived` is installed before `createWindow()`.
8. the webview-count cap decrements on `destroy`.
9. rate-limit counts a subscription once (at subscribe), not per event.
10. message size cap is checked before any parsing.
