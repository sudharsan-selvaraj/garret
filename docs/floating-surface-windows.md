# Floating surface windows — design

**Status: design, pre-implementation.** A general, durable primitive: a running widget can open a
**sibling surface from its own package** as a **floating, focusable OS window**, passing initial
props and getting a handle back. Built once, usable by any widget — the device-mirror is just the
first consumer.

> Grounded in the current code: reuses `WidgetSurface` (`src/renderer/src/ext/WidgetSurface.tsx`),
> the `extBridge` self-bind + origin verification (`src/main/ext/lane.ts`), the capability broker
> (`src/main/ext/broker.ts`), one-host-per-instance (`src/main/ext/host.ts`), and the `windowRole`
> renderer routing (`src/renderer/src/main.tsx`). The floating window is a thin window shell around
> the *existing* surface primitive — no parallel rendering or binding path. See
> [[three-widget-layers]] and `docs/architecture.md`.

## 1. Concept

A **surface** is a distinct UI entry inside an extension package:

- Every package has one **primary surface** (`ui` in the manifest) — placeable from the Add gallery,
  lives on the board. Unchanged from today.
- A package may declare **secondary surfaces** — *not* in the Add gallery. They exist only to be
  opened programmatically, by a sibling surface **of the same package**, as floating windows.

Why a floating window (not another board widget) for the device-mirror case: active control needs
reliable keyboard/mouse **focus**. A board widget is on the desktop/HUD layer and goes click-through
when ambient — fine for viewing, wrong for typing into a device. A floating window activates.

Why "same package only": a secondary surface shares the **exact consent ceiling** the user already
approved for this extension. No capability escalation, no new consent prompt, no way to summon
another author's widget. This single restriction is what makes "a widget opens a widget" safe.

## 2. Manifest — multiple surfaces

```jsonc
{
  "id": "adb-devices",
  "ui": "dist/ui",                    // primary, placeable (unchanged)
  "host": "dist/host/index.cjs",
  "capabilities": ["process", "windows"],   // "windows" is new — see §6
  "surfaces": {
    "device-mirror": {
      "name": "Device Mirror",
      "ui": "dist/mirror",            // served at garret://<id>/mirror/
      "defaultSize": { "w": 420, "h": 780 },   // PX (a window), not grid units
      "minSize": { "w": 300, "h": 500 },
      "resizable": true
    }
  }
}
```

- `surfaces` — map of `surfaceId → { name, ui (contained path), defaultSize (px), minSize (px),
  resizable, frame (default true), transparent (default false) }`. `frame:false` + `transparent:true`
  give a chromeless, non-rectangular window (e.g. a rounded phone screen); a transparent surface gets
  no opaque fill or square shadow. **`transparent` forces user-resize off** (unreliable on macOS) —
  size it with `g.window.resize` instead. **A frameless surface must provide its own move (a
  `-webkit-app-region: drag` region) and close affordance**; the guaranteed escape hatch is
  disabling the extension (→ `closeSurfacesForExt`). `g.window.*` ops are throttled per window.
- Secondary-surface sizes are **pixels** (they're windows), unlike the primary's grid `defaultSize`.
- Each surface `ui` is validated at install like the primary (contained path, exists), and served over
  the same `garret://<id>/<path>/` scheme with the same per-tier CSP.

## 3. SDK API

```ts
// Available on the platform: g.surfaces (both tiers; gated by the "windows" capability).
interface SurfaceApi {
  // Reload-durable close tracking: a handle's onClose/closed() live in the opener's current context
  // (a webview reload discards them — the surface itself survives). onClosed re-subscribes fresh on
  // each mount and still receives closes for surfaces this placement opened before the reload.
  onClosed(cb: (instanceId: string) => void): () => void
  open(surfaceId: string, opts?: {
    props?: Record<string, unknown>    // structured-clone → isolated per surface (mutations local)
    title?: string
    size?: { w: number; h: number }    // px; overrides manifest defaultSize
    alwaysOnTop?: boolean              // default true — a mirror stays visible while you work
    key?: string                       // singleton: a repeat open() with the same key focuses the
                                       // existing window instead of spawning another (a mirror uses
                                       // key=serial → one window per device; omit for always-new)
  }): Promise<SurfaceHandle>
}

interface SurfaceHandle {
  readonly id: string                  // the spawned instanceId
  close(): Promise<boolean>
  focus(): Promise<boolean>
  closed(): Promise<void>              // resolves when the window closes (method, not a property —
                                       // contextBridge-safe). onClose is the callback form.
  onClose(cb: () => void): () => void
}

// Inside a spawned surface, read its launch props. `{}` until the runtime binds; use the React
// `useProps<T>()` hook (re-renders on ready) or await `g.onReady(...)` for non-React.
g.props: Record<string, unknown>       // {} for the primary/board surface

// A surface shapes its OWN window (no-op for a board widget) — e.g. lock the aspect ratio once you
// know your content size. Scoped in main to the window that embeds the caller.
g.window.setAspectRatio(ratio: number): void   // w/h; 0 clears
g.window.resize(width: number, height: number): void
```

Usage (the device list opening a mirror per click):

```ts
const h = await g.surfaces.open('device-mirror', { props: { serial }, title: model })
h.onClose(() => /* update the row's "mirroring" state */)
// open N times → N independent floating mirrors.
```

## 4. IPC + wire

New channels (`src/shared/ipc/channels.ts`):

- `extSurfaceOpen` (invoke): `(surfaceId, opts) → { instanceId }`. Main derives the caller from the
  **bound** `e.sender.id`; see §5 for the full gate.
- `extSurfaceClose` (invoke): `(instanceId)`.
- `extSurfaceFocus` (invoke): `(instanceId)`.
- `extSurfaceInit` (invoke): `() → { extId, instanceId, uiUrl, preloadUrl }` (render config; props go
  via `extBind`). Called by the
  spawned surface's renderer; main reads **`e.sender.id`** and returns that window's record. This is
  the props channel — see below.
- `extSurfaceClosed` (event → opener): fired to the opener's webContents when a spawned window
  closes, so its handle's `onClose`/`closed` resolve **exactly once** (idempotent drop from the
  record map, guarded like `killHost`'s `hosts.has`).

**Props delivery (shipped — B1 fix).** Props are **never** looked up by a guest-supplied instanceId.
When main creates the surface window it knows the window's top-level `webContents.id` (`surfaceWcId`).
Props reach the guest through the guest's **`extBind`**, returned only when the binding webview is
genuinely hosted inside that surface window — `surfacePropsForBind` checks
`e.sender.hostWebContents?.id === surfaceWcId` (the embedder relationship is unforgeable). So no other
guest (not even a second placement of the same ext) can harvest another window's props, and a board
widget's bind gets `{}`. `instanceId` is a `randomUUID()` (unguessable), so the derived config key
`ext.config.<extId>.<instanceId>` isn't guessable either. (`extSurfaceInit`, keyed on the surface
window's own top-level `e.sender.id`, returns only render config — never props.)

## 5. Main — the SurfaceWindow manager (`src/main/windows/surfaceWindow.ts`)

The `extSurfaceOpen` handler (in the ext lane, so it shares `bound`), then `openSurface(...)`:

1. **Reject open-before-bind (B2):** `const opener = bound.get(e.sender.id); if (!opener) throw`.
   An unbound `garret://` guest (mid-load, or one whose host failed) cannot open.
2. **Gate the capability explicitly (should-fix):** `extSurfaceOpen` is a *separate* handler and does
   NOT flow through `platformCall`, so it must call `gate(opener, 'windows')` itself.
3. **Same-package from the trusted spec (B2):** look up `surface = resolveEnabled().find(opener.extId)
   .spec.surfaces[surfaceId]`; reject if absent. `surfaceId` is only ever a key into the *trusted
   resolved spec* — never a path the guest supplies.
4. **Limits (should-fix — focus abuse):** enforce a per-owner **concurrent-surface cap** and an
   **open rate limit** in main. `open()` spamming always-on-top windows is worse than the already-
   denied `window.open`.
5. **Ownership (B3):** the owner is `ownerKey = ${opener.extId}:${opener.rootInstanceId}` — the
   **stable board-placement identity**, not a wcId. A surface opening a surface (chained) inherits the
   opener's `rootInstanceId`, so the whole tree is owned by the root board placement and closes with it.
6. Generate `instanceId = randomUUID()`; store a record **keyed by `instanceId`** (with `surfaceWcId`,
   `extId`, `surfaceId`, `props`, `ownerExtId`, `ownerInstanceId`, `openerWcId` as fields) once the
   window's `webContents.id` exists.
7. Create a **focusable, movable, resizable** `BrowserWindow` (NOT `makePanel` — we *want* activation
   for keyboard; the opposite of the HUD/clipboard picker). `alwaysOnTop` at the `floating` level by
   default (above normal windows, still focusable). preload = `index.js` with
   `--garret-role=surface --garret-surface=<instanceId>`. Position: cascade near the opener / cursor,
   clamped to the work-area. Add a `will-navigate`/`will-redirect` deny on the surface guest wc so it
   can't leave `garret://`.
8. On `closed`: `killHost(wcId)`, idempotently drop the record, notify the opener via
   `extSurfaceClosed`. The surface wc self-binds like any guest, so it lives in `bound` and is already
   covered by `revokeExt`/`broadcastActive`.

Lifecycle hooks:

- `closeSurfacesForExt(extId)` — from `revokeExt` (disable / uninstall / update): close all its
  surface windows so none survives a capability change.
- `closeSurfacesForOwner(ownerKey)` — see §9 (keyed on `{extId, instanceId}`, reload-safe).

## 6. Security

- `g.surfaces.open` is gated by a new **`windows`** capability (revives the slot deferred in
  architecture.md §10). Added to `SIMPLE_CAPS` in `manifest.ts` — it is **not** a system cap, so it
  does **not** force full tier: a web-tier widget may open a pure-UI floating surface (a settings/detail
  panel), gated by the same cap + the §5 count/rate limits. Shown at install ("Open floating windows").
  Same-package spawns inherit the ceiling, so no *re-consent*, but it's disclosed. **The
  `extSurfaceOpen` handler must call `gate(opener, 'windows')` — it bypasses `platformCall`/`gate`
  otherwise** (should-fix).
- Same-package only, from the trusted resolved spec (B2, §5). No cross-extension open.
- The surface window is a normal `garret://<extId>/…` guest on `persist:garret-ext`: same per-tier
  CSP (that partition has no `onHeadersReceived` override, so the ext protocol's CSP applies
  untouched), same origin-verified self-bind, same broker ceiling. The existing `web-contents-created`
  window-open deny (`index.ts`, keyed on `type === 'webview'`) carries over. Plus the §5 nav-lock.
- Props are structured-clone → each surface gets its own isolated copy (not frozen; mutations are local).

## 7. Renderer + multi-surface serving

- `main.tsx`: add `else if (windowRole === 'surface')` → mount `SurfaceWindowRoot`.
- `SurfaceWindowRoot` calls `extSurfaceInit()` (main reads `e.sender.id`) → `{ extId, instanceId,
  uiUrl, preloadUrl }`, and renders a single full-window `<WidgetSurface>` — reused as-is
  (crash isolation, retry included).

**Serving a second UI dir (should-fix — the resolver only maps one dir per ext today).**
`protocol.ts`'s resolver maps `id → uiDirs.get(id)` (a single dir), so `garret://<id>/mirror/` would
resolve under the *primary* ui dir and 404 when `surfaces.device-mirror.ui` is a sibling. Fix:
`resetUiDirs` registers, per ext, the **ext root dir** plus each surface's relative path; a reserved
prefix disambiguates — **`garret://<id>/` = primary ui**, **`garret://<id>/~<surfaceId>/` = that
surface's ui dir** (primary URLs unchanged). `containedPath` validates every `surfaces.*.ui` against
the ext base dir at install (`manifest.ts` currently validates only `ui`/`host` — add a loop over
`surfaces`).

## 8. Host model + ephemerality

- Each surface window self-binds → gets its **own host** (existing one-host-per-instance). So each
  mirror runs its own scrcpy stream for its serial, independently. The host is the same `host` entry;
  it just responds to whatever methods that surface's UI calls (list UI → `listDevices`; mirror UI →
  `startScrcpy(serial)`). No per-surface host declaration.
- Surface windows are **ephemeral** — never written to the board layout; nothing reopens on restart
  (correct for a live device mirror).

## 9. Lifecycle — DECIDED: close-with-opener (reload-safe, B3 fix)

Spawned windows close when their opener **board placement** is genuinely removed. The subtlety (B3):
the opener is a `<webview>`; its webContents is destroyed on a plain **reload / crash-Retry
(`WidgetSurface` nonce bump) / HMR** too, with a *new* wcId on rebind. Keying close-with-opener on
wcId would let the widget's own Retry flow nuke every live mirror. So:

- **Own surfaces by the stable `{extId, instanceId}`** (`ownerKey`), never wcId — the same identity
  `extConfig` already uses (`lane.ts`), which survives reload.
- **wc `destroyed` alone does nothing to surfaces.** A reload re-binds the same `{extId, instanceId}`
  (from the `?instance=` URL) → main re-points `extSurfaceClosed` delivery to the new wcId; surfaces
  stay up.
- **True removal is an explicit signal — NOT a React unmount.** (Phase-3 review correction: an
  unmount-cleanup hook conflated "removed" with "unmounted for another reason" — layout switch and
  renderer reload both unmount `WidgetSurface` and would wrongly close live surfaces.) The signal is
  fired from the board store's explicit `removeWidget(id)` action → `extInstanceGone(extId, instanceId)`
  → `closeSurfacesForOwner`. So a **layout switch keeps** the floating surfaces (the placement still
  exists; the window is independent of which board is shown) and a **renderer reload keeps** them
  (rebind → `repointOwner`). Extension disable/uninstall is handled entirely main-side by `revokeExt`
  → `closeSurfacesForExt` (the renderer signal is not involved). *Known minor gap: deleting a whole
  layout removes its widgets without emitting per-widget removal, so their surfaces stay open until
  the user closes them or quit — acceptable for v1.*
- `revokeExt` (disable/uninstall) → `closeSurfacesForExt(extId)`. App quit closes all.

A closing surface also closes any surfaces **it** opened (chained children): `onClosed` →
`closeSurfacesForOwner(extId, thisInstanceId)`, so a subtree tears down with its root.
`handle.close()` (programmatic) and the user closing the window both fire `onClose`/`closed` exactly
once (idempotent record drop). (Relaxing to "independent/detached" later is additive: a
`detached: true` open option, no contract change.)

## 10. Phasing

1. **Manifest + validation** — parse `surfaces`, add the `windows` capability, validate surface `ui`
   paths + serve them. *(adversarial review)*
2. **Main window manager + IPC** — `surfaceWindow.ts`, open/close/focus/closed, same-package +
   capability gating, props store, revoke integration. *(adversarial review)*
3. **Renderer `surface` role + SurfaceWindowRoot** — reuse WidgetSurface. *(adversarial review)*
4. **SDK** — `g.surfaces.open` + `SurfaceHandle` + `g.props`; broker domain + extBridge wiring.
   *(adversarial review)*
5. **First consumer** — `adb-devices`: a `device-mirror` surface (ya-webadb `@yume-chan/scrcpy` +
   WebCodecs), the list opens one per device. Validates the whole primitive end to end.
