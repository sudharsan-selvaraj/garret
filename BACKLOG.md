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
   hook transport through `client` instead of `window.garret` directly. *Do this first — it
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

### Code-signing + notarization
**Prerequisite for distributing the app to anyone but yourself.** Today's build is unsigned, so
Gatekeeper blocks first launch (users must right-click → Open / strip quarantine). Required once
Garret is shared via a download link or beyond your own Macs.

Needs an **Apple Developer Program** membership ($99/yr) for a *Developer ID Application* cert.
Work, in order:
1. In `electron-builder.yml`: set a real `mac.identity` (replace `identity: null`); add
   `mac.hardenedRuntime: true` + an entitlements plist if needed.
2. Add an `afterSign` notarize hook (`@electron/notarize`, or electron-builder's `notarize`
   config) using `xcrun notarytool` with an App Store Connect API key (or Apple ID + app password).
3. Wire CI secrets into [`.github/workflows/release.yml`](.github/workflows/release.yml):
   `CSC_LINK` (base64 .p12) + `CSC_KEY_PASSWORD`, and the notarytool credentials; drop
   `CSC_IDENTITY_AUTO_DISCOVERY=false`.
4. Verify: `spctl -a -vv Garret.app` reports *accepted / Notarized Developer ID*.

## Other deferred
- Sandbox ESLint guardrails (the project has no ESLint yet): a `no-restricted-properties`
  rule forbidding `ipcRenderer.invoke`/`send` in the bridge-preload, and a rule forbidding
  `window.addEventListener('message', …)` in the host renderer. Both invariants currently
  hold (verified by grep); the lint rules would prevent a regression. Needs an ESLint setup.
- Trusted-local tier polish: hot-reload / "Reload widgets" action; unknown-widget card names the
  missing id; decide dev-cwd vs userData dir.
- Calendar: non-primary calendars.
- Windows support (desktop pinning via WorkerW).
- Production CSP — safe to tighten now that external widgets are dev-only (`new Function` path
  doesn't run in packaged builds); revisit when the sandbox tier lands.
- ~~Packaging (electron-builder, native-addon bundling, release workflow)~~ — done.
