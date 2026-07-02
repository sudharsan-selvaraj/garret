# Phase 4 — Install lifecycle + consent (design, rev 2)

> **⚠️ Historical / superseded.** This describes install/consent for the old **third-party
> (sandboxed) widget** tier. The lifecycle (disclosure consent, enable/disable/remove/update, sha256
> integrity) carried forward into the unified installer (`src/main/ext/install.ts`), but the tier
> framing is historical: the two former widget tiers were unified into ONE extension path —
> `@garretapp/sdk` (package `packages/sdk`), main-side `src/main/ext/*`, renderer-side
> `src/renderer/src/ext/*`, preload `src/preload/extBridge.ts`, the single **`garret://`** scheme,
> renderer prefix `gx:`. Tier is now **derived** from declared capabilities. See
> `docs/architecture.md` (reconciliation banner + old→new file-path map) and `docs/garret.html`.

Open the distribution channel: **install** a third-party (sandboxed) widget, **see what it
asks for** before approving (disclosure-only consent), **manage** it (enable/disable/remove/
update), with an **integrity** baseline and honest **provenance** disclosure. Phase 3 made
third-party code safe to *run*; Phase 4 makes it safe to *adopt*.

v1 = **install from a local folder**, consent, an Extensions manager, sha256 integrity,
provenance *disclosure*. Signing, a remote marketplace, and origin-pinned auto-install are
**deferred** (§7).

> rev 2 folds in the staff-critic review. Two blockers fixed: (B1) the **install record's
> `consentedPermissions` is the authoritative enforcement ceiling** — never the mutable
> on-disk `manifest.json`; (B2) **`manifest.id` rejects `..`/dot-forms** (path escape). Plus
> the §10 answers, a precise integrity-hash spec, and the missing lifecycle cases (§8).

## 1. What this builds on

The Phase-3 loader discovers `<userData>/widgets/<id>/manifest.json` and runs each in an
isolated webview with declared-permission enforcement. Phase 4 is the validated front door
to that directory + the permission ceiling the loader must honor.

## 2. Identity, layout & install record

**`id`** = `manifest.id`, **lowercased**, matching `/^[a-z0-9._-]+$/` AND containing ≥1
alphanumeric AND with **no `.`/`..` path segment** (reject `.`, `..`, leading-dot, `a/..`,
etc.). Reserved/dot-only ids are rejected at install. (The Phase-3 `protocol.ts` `SAFE_ID`
gets the same `..` hardening — defense in depth, though install never creates such a dir.)

```
<userData>/widgets/<id>/
  manifest.json            # widget's manifest — used for DISPLAY ONLY (name/desc/size/icon)
  index.html, bundle.js…   # widget's files
  .garret-install.json     # host-written record — the SOURCE OF TRUTH for trust
```
Install record:
`{ source, version, sha256, consentedPermissions, everUsedCapabilities, enabled, installedAt }`.

## 3. Install lifecycle (main)

### 3a. Consent integrity (B1 — the core invariant)
**The enforced permission ceiling is `.garret-install.json.consentedPermissions`, NOT
`manifest.json.permissions`.** So:
- `listSandboxedWidgets()` reads BOTH files and returns `{ id, displayManifest, consentedPermissions, enabled }`.
- `makeSandboxedPlugin` passes **`consentedPermissions`** (not the manifest's) to
  `SandboxWidget` → `BridgeHost`. `manifest.json` only supplies display fields.
- Editing the on-disk `manifest.json` therefore cannot widen what the bridge allows — only
  a host-mediated install/update (which writes the record) can, and that goes through
  consent. This is what makes the consent screen an honest ceiling.

### 3b. `installWidgetFromFolder(srcDir)` → returns a plan (no files written)
1. Read + validate `manifest.json`: shape (id/name/defaultSize, permissions = string[]),
   the `id` rules (§2), `apiVersion` ≤ supported major, permission grammar
   (`service:`/`network:`/`files:read`/`storage`/`openExternal`; **lowercase + reject
   `network:` with a literal private/reserved IP** at install).
2. If `<userData>/widgets/<id>` exists: it's an **update** → compute *added* perms vs the
   record's `consentedPermissions`. If the existing install's source differs and it's not a
   deliberate update, surface "already installed — update or cancel."
3. Compute the **source integrity hash** now (see §3d) and return it in the plan. Renderer
   shows consent (§4); calls back confirm/cancel.

### 3c. On confirm — safe copy → record → register
- **Dispose any live instance** of this id first (the renderer destroys the SandboxWidget so
  no webview is serving the directory mid-swap).
- Copy into `<userData>/widgets/.tmp-<rand>/` (**always inside userData → same filesystem, so
  the final rename is atomic**, no `EXDEV`), then atomic-rename over `<id>`. Per entry:
  **`lstat` (never follow) and reject symlinks**, reject any path that doesn't resolve inside
  `srcDir` (`normalize(join(srcDir,rel)).startsWith(srcDir+sep)`), allow only an **extension
  allowlist** (`.html/.js/.mjs/.css/.json/.map/.png/.jpg/.jpeg/.svg/.woff2`), enforce a
  **size cap (~20 MB) + file-count cap (~200)**.
- **Re-hash the copied tree and compare to the plan's hash; abort if changed** (closes the
  plan→copy TOCTOU).
- Write the record: `consentedPermissions` = the approved set (**replace, never accumulate**);
  `enabled: true`; `sha256`; `installedAt`.
- Tell the renderer to (re)register the plugin — no app restart.

### 3d. Integrity hash (precise, stable)
`sha256( utf8( JSON.stringify( sortedObject{ relpath: sha256hex(fileBytes) } ) ) )`, where
`relpath` is `/`-separated, UTF-8 NFC, and keys are sorted by code unit. Deterministic across
platforms; defined once so two implementations can't diverge.

### 3e. remove / enable / update
- `removeWidget(id)`: dispose live instance, delete the dir + record.
- `setEnabled(id,on)`: flip the record; disabled ⇒ not registered/rendered.
- `updateWidget(srcDir)`: as install; re-consent iff new perms ⊄ `consentedPermissions`; on
  confirm, **replace** `consentedPermissions` with exactly the new manifest's set.

## 4. Consent screen (renderer) — disclosure only

Modal before an install/update completes; **never** a safe/unsafe verdict:
- Name + **source** + version + a clear "**runs sandboxed & isolated**" line.
- **Declared capabilities, human-readable**: `service:atlassian` → "Read your Atlassian
  data"; `network:api.github.com` → "Connect to api.github.com"; `files:read` → "Read files
  you point it at"; `openExternal` → "Open links in your browser (asks each time)";
  **storage is always granted** → always show "Stores its own settings locally (isolated to
  this widget)"; no others → "No network or account access".
- Update adding perms: a **"new permissions since you installed this"** section.
- **Install / Cancel** (Cancel default-focused). An "**unverified author — only install
  widgets you trust**" note (provenance, §6).

## 5. Extensions manager (settings pane)

A "Widgets" section listing each installed sandboxed widget: name, version, source, enable/
disable, **Remove**, the declared-permission disclosure, and the **declared-vs-used diff** —
live widgets show the `BridgeHost` session set; offline widgets show the persisted
`everUsedCapabilities`; undeclared attempts show "**also tried (blocked): …**". An **"Install
widget…"** button → folder picker → consent flow.

## 6. Integrity & provenance (v1)

- **Integrity = corruption detection, not attacker defense (honest framing):** both the files
  and the recorded hash live in user-writable `userData`, so a local-write attacker can
  rewrite both. Re-hash-on-load catches *accidental* corruption (partial write, sync
  conflict, disk error) → refuse to run with a clear error. It does NOT claim to stop a
  motivated local attacker. **Fast path:** stat each file's mtime vs `installedAt`; only
  re-hash if an mtime differs (cheap clean boots; the hash is still the real check). Use
  `mtime > installedAt` with a 1s slop for coarse (HFS+) mtime resolution — a same-second
  rewrite would skip the fast-path's re-hash, but the fast-path only gates *whether* to hash,
  not correctness, so this is acceptable.
- **Provenance (v1 = disclosure):** record + show `source`; label every v1 install
  **"unsigned / unverified author"** — we don't claim trust we can't prove.
- **Deferred:** cryptographic signatures / origin-pinned install + author identity;
  provenance-driven re-consent. v1 re-consent is permission-change-driven only.

## 7. NOT in Phase 4 v1 (deferred)

`.garret-widget` signed-zip + vetted unzip (slip guard); remote/marketplace browse+download;
GitHub origin-pinned auto-install + update checks; cryptographic signing/verification +
author identity; `files:read:<prefix>` scoping; `.wasm` (intentionally excluded — no
`wasm-unsafe-eval` in the CSP); static declared-vs-used at install (undecidable — runtime
diff only).

## 8. Lifecycle correctness & security notes

- **Consent honesty** holds ONLY because of §3a (the record, not the manifest, is the
  ceiling). A widget under-declaring just gets its own calls denied (and shown in the
  used-vs-declared diff).
- **Orphaned / disabled board instances:** a placed widget whose plugin is removed or
  disabled must render a **placeholder card** ("widget removed" / "disabled — enable in
  Extensions"), never crash. (The registry already returns `undefined` for unknown ids — the
  host renders the placeholder.)
- **Install-while-live:** dispose the live instance before the copy/rename (§3c) so no webview
  serves a half-swapped directory.
- **No zip-slip** (folder copy + per-entry lstat/containment/extension/size guards; temp dir
  inside userData + atomic rename → never a half-install).
- **`updateConfig` rate-limit:** route guest `updateConfig` messages through the BridgeHost
  token bucket too (Phase-3 fix), so a widget can't spam host state updates.
- **Disabled = not registered** (no webview/bridge/subscriptions).

## 9. Build plan

1. main `src/main/sandbox/install.ts` (+ harden `protocol.ts` SAFE_ID): validate/plan/
   safe-copy/hash/record-rw/remove/setEnabled/update; IPC + preload API. `listSandboxedWidgets`
   returns `consentedPermissions` + `enabled`; loader uses them + mtime-fast-path re-hash.
2. renderer consent modal + install flow (folder via `pickDirectory`).
3. renderer Extensions manager pane (list/install/remove/enable-disable + disclosure).
4. persist `everUsedCapabilities` (main updates the record from BridgeHost dispositions);
   surface in the manager; route `updateConfig` through the rate limiter.
5. placeholder card for removed/disabled board instances.
6. acceptance: install sample (consent shows network+openExternal+storage), enable/disable,
   **edit on-disk manifest to add a perm → NOT enforced (record wins)**, tamper bundle → load
   refuses, update adding a perm → re-consent, remove → placeholder on the board.

## 10. Decisions (open questions closed)

1. **Folder install for v1** (no zip → no zip-slip); signed-zip is v2.
2. **Lazy re-hash** via mtime fast-path; full hash only when an mtime changed.
3. **Persist `everUsedCapabilities`** in the record (merge, never remove); manager shows
   live-session set for live widgets, persisted set otherwise.
4. **Re-consent on ANY added permission** (exact normalized-string superset check, incl. a
   new `network:` host).
5. **Keep enable/disable** (reversible; remove is destructive).

**Build-time-verify (the design mandates these; they don't exist in code yet — do them in
§9.1 and run the §9.6 acceptance test before any user-facing install):**
- `listSandboxedWidgets` reads `.garret-install.json` and returns `consentedPermissions` +
  `enabled`; `makeSandboxedPlugin` passes `consentedPermissions` (NOT `manifest.permissions`)
  to `BridgeHost`; the loader skips disabled widgets. (Closes B1 at the code layer.)
- `protocol.ts` `SAFE_ID` → `/^[a-z0-9][a-z0-9._-]*$/` (leading alphanumeric, lowercase). (B2.)

**Deferred nit:** on a permission-removing update, `everUsedCapabilities` may show a
now-undeclared capability the widget used legitimately under the old consent — a cosmetic
manager-label issue (enforcement via `consentedPermissions` is unaffected).
