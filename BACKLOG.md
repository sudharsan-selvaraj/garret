# Backlog

## High priority

### Sandboxed tier for third-party widgets
**Prerequisite for ANY widget distribution channel (share / URL / marketplace).** Build the
sandbox *before* the channel opens — the current trusted-local `new Function` tier can't ship
under a production CSP, and isolation can't be retrofitted onto live third-party widgets.

Contract: [`docs/external-widget-contract.md`](docs/external-widget-contract.md).

Work, in order:
1. **Refactor the SDK to the layered core** — `@garret/core` (pure) + `createSDK(React, client)`
   (hook logic, bound per realm) + `ipcClient` (native transport). Behavior-preserving; route
   hook transport through `client` instead of `window.myview` directly. *Do this first — it
   unblocks everything and is low-risk.*
2. **iframe host + postMessage capability bridge** — render each external widget in an isolated
   iframe; `bridgeClient` proxies `GarretClient` over the bridge; secrets never cross.
3. **Enforce declared permissions at the bridge** — service allowlist + per-host network
   allowlist + clipboard/files gating. (Today permissions are declared+logged only.)
4. **`@garret/widget-sdk` package** — bundled by third-party widgets (their own React + `createSDK`).
5. **Disclosure validator + consent UX** — capability disclosure + declared-vs-actually-used
   mismatch at install. Disclosure only, never a safe/unsafe verdict.
6. **Provenance + integrity** — signed/origin-pinned install, hash verification, re-consent on
   permission change.
7. **Install lifecycle + Extensions manager** — `userData/widgets` dir, install/update/remove,
   enable/disable, review/revoke permissions.

## Other deferred
- Trusted-local tier polish: hot-reload / "Reload widgets" action; unknown-widget card names the
  missing id; decide dev-cwd vs userData dir.
- Calendar: non-primary calendars.
- Windows support (desktop pinning via WorkerW).
- Packaging / distribution (electron-builder; `git`-on-PATH; bundle the native addon; production CSP).
