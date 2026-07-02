# Native Extensions — Phase 3: loading, install & consent (design, rev 2)

> **⚠️ Historical / superseded.** This describes install/consent for the old **native tier**. The
> install/consent + HMAC-signed-record model carried forward into the unified installer
> (`src/main/ext/install.ts`), but the two-tier framing here is historical: the two former widget
> tiers were unified into ONE extension path — `@garretapp/sdk` (package `packages/sdk`), main-side
> `src/main/ext/*`, renderer-side `src/renderer/src/ext/*`, preload `src/preload/extBridge.ts`, the
> single **`garret://`** scheme, renderer prefix `gx:`. Tier is now **derived** from declared
> capabilities. See `docs/architecture.md` (reconciliation banner + old→new file-path map) and
> `docs/garret.html`.

## rev 2 — critic deltas (adversarial security pass, folded in)

The critic's verdict was **build-with-BLOCKERS-fixed**; the three blockers invalidated the core
claim, so they're resolved here (later sections still describe rev-1 shapes — **these deltas win**):

- **B1 — the MAC must bind identity + full-tree hash, and the loader AND-gates.** Sign
  `{id, dirname, version, fullTreeSha256, enabled, installedAt}` (was: record-minus-mac, which was
  *portable* — a legitimately-enabled record from any extension could be dropped next to malicious
  code). `registry()` honors `enabled` **only if** `macOk && record.id === dirname &&
  recomputedFullTreeSha256 === record.sha256` — one AND-gate, not three separate display flags.
- **B2 — hash EVERY file, not just served types, and don't skip dotfiles.** The sandbox hashes only
  `ALLOWED_EXT` and skips dotfiles because it only ever *serves* those. A raw-Node entry can
  `require('./x')` / `fs.readFileSync('.payload')` at runtime, so a skipped file is post-consent
  tamper that passes both the TOCTOU re-hash and the integrity check. Native `collectFiles` hashes
  **every regular file** in the tree (still: reject symlinks, reject `.node`), dotfiles included.
- **B3 — retract "PATH-binaries only"; it was false.** A full-access extension can `execFile` any
  binary it ships (a Mach-O named `x.map`/`helper.bin`), so rejecting `.node` never delivered
  "PATH-binaries only." We still reject `.node` — but for a **packaging/ABI** reason (§9: we can't
  `require` it reliably anyway), **not** as a security boundary. The consent copy (§6) states the
  truth: *an enabled extension can run any program, including binaries it ships._

Also folded (SHOULD-FIX):
- **safeStorage unavailable → fail closed.** No plaintext-key fallback (that's *zero* mitigation vs
  the file-write attacker it defends against). Instead: refuse to persist `enabled:true`, require
  re-consent every launch, and surface "integrity protection unavailable on this platform."
- **Loader re-asserts `kind === "extension"`** on the on-disk manifest at load time (defense in
  depth over the separate-root + separate-record-file split).
- **`enabled` is hard-coded `false` on fresh install** (never `prior?.enabled ?? true` — that
  sandbox default auto-enabling full-access code is the exact §1 catastrophe). On update, prior
  `enabled` is preserved **only if the prior record's MAC verified**.
- **Any code change re-consents.** Native has no permission set, so "silent update when nothing new
  is *declared*" (the sandbox behavior) would let benign-v1→malicious-v2 through. **Any `sha256`
  delta on update resets `enabled:false` and requires full re-consent**, regardless of `declared`.
- **Consent confirmation:** type a **fixed phrase not shown on screen** (e.g. `I trust this`) rather
  than the extension name (which is displayed → glance-and-type reflex). Show the **source path**
  prominently. Don't oversell it as more than an accidental-click / habituation guard.
- **HMAC stays in Phase 3** (not deferred to Phase 5): default-OFF alone is a plain-JSON boolean in
  writable userData — flipping it *is* the whole §1 attack.

NIT accepted: don't dress `source` up as "provenance" (it's just where the file sat); note the
double full-tree re-hash (plan + commit) has real latency at 100 MB.

---

Status: **design, critic-hardened (1 round: security/impl-realism).** Turns the hardcoded `hello`
fixture (`lane.ts registry()`) into a
real tier: native extensions are **installed artifacts**, **default-OFF**, run only after an
**honest full-access consent**, and are managed alongside sandboxed widgets. Builds on Phases 1–2
(host + bridge + UI lane, committed `172e34c`, `03ad7de`) and mirrors the hardened sandbox install
lifecycle (`src/main/sandbox/install.ts`, `docs/phase4-design.md`).

This maps to the native design doc's **MVP-c** (`docs/native-extensions-design.md` §3, §6, §10).

## 0. Scope

**In:** manifest format for `kind: "extension"`; install from folder + `.garret` file; per-extension
enable (default OFF) gated by full-access consent; a native tier in the Add dialog + Manage
Widgets; replace `registry()` with a disk loader. **Out (later phases):** Seatbelt/TCC separation
(Phase 5), the Device Control extension itself (Phase 4), floating windows, native-module (`.node`)
packaging, process-audit panel.

## 1. The one thing this phase is really about

Everything here exists to protect a single decision: **should this full-access program run on my
Mac?** A native extension has no runtime permission gate (design doc §1) — the *only* real defense
is the user making an informed trust choice, and the machinery not letting that choice be forged or
bypassed. So the enable flag is the crown jewel. Two hard requirements fall out:

1. **Nothing runs until the user deliberately enables it** (default OFF), after a consent screen
   that states full-access plainly — not a permission list that implies a boundary that isn't there.
2. **The enable flag can't be flipped behind the user's back.** The install record lives in
   writable `userData`; forging `enabled: true` would auto-run full-access code with Garret's TCC
   grants. We authenticate the record (§5).

## 2. Manifest (`kind: "extension"`)

A native extension folder has a top-level `manifest.json`:

```jsonc
{
  "kind": "extension",          // discriminator — MUST be "extension" (else routed to sandbox)
  "id": "device-control",       // ID_RE: /^[a-z0-9][a-z0-9._-]*$/  (no "..", no "/")
  "name": "Device Control",
  "version": "0.1.0",
  "apiVersion": 1,
  "description": "List and control connected Android/iOS devices.",
  "node": "node/main.cjs",      // rel path to the raw-Node host entry (contained; no "..")
  "ui": "ui/",                  // rel path to UI dir; must contain index.html
  "binaries": ["adb", "scrcpy"],// DECLARED, NOT enforced — shown in consent
  "network": ["*"],             // DECLARED, NOT enforced — shown in consent
  "defaultSize": { "w": 4, "h": 4 }
}
```

- `kind` is the umbrella-format discriminator (`install.ts` already reads it; today it only knows
  `widget`/`pack`). The **installer routes by `kind`**: `"extension"` → native lifecycle (§4),
  anything else → the existing sandbox lifecycle. A file that lies about `kind` gets the runtime it
  named — an `"extension"` gets full-access consent, a `"widget"` runs sandboxed regardless — so the
  discriminator is self-consistent and can't be used to sneak full access past the easy dialog.
- `node` and `ui` are validated for containment exactly like sandbox `preview` (`install.ts:186`):
  reject absolute, reject `..`, `normalize`+`startsWith(base+sep)`. `node` must resolve to a file;
  `ui` to a dir containing `index.html`.
- `binaries`/`network` are **disclosure only** (design doc §6) — arrays of strings, shown verbatim
  on the consent screen labeled "**declared by the author — not enforced by Garret**."

## 3. Storage layout — separate from sandbox

Native extensions install to **`<userData>/extensions/<id>/`** — a *different* root from
`<userData>/widgets/<id>/` (sandbox). No collision, no accidental cross-tier load, and a native
`.node` file can never land where the sandbox loader would try to serve it.

Install record `<userData>/extensions/<id>/.garret-ext.json` (host-written, authoritative):

```jsonc
{
  "id": "device-control",
  "version": "0.1.0",
  "source": "/path/or/staged",         // provenance disclosure
  "sha256": "…",                        // integrity baseline (tamper/corruption)
  "declared": { "binaries": ["adb","scrcpy"], "network": ["*"] },  // display only
  "enabled": false,                     // DEFAULT OFF — the crown jewel (§1)
  "installedAt": 1750000000000,
  "mac": "…"                            // HMAC over the record (§5) — authenticates `enabled`
}
```

## 4. Install lifecycle (mirror `install.ts`, native deltas)

Reuse the sandbox install shape 1:1 — `planInstall` (validate, hash, writes nothing) →
consent → `commitInstall` (re-hash TOCTOU guard, atomic temp+rename, write record). New module
`src/main/native/install.ts`. Deltas from the sandbox version:

| Concern | Sandbox (`install.ts`) | Native (Phase 3) |
|---|---|---|
| Allowed file types | html/js/css/json/img/woff2 | **+ `.cjs`, `.mjs`, `.map`; still REJECT `.node`** (design §9 — MVP is PATH-binaries only) |
| Required files | `manifest.json` + `index.html` at root | `manifest.json` at root; `<node>` file exists; `<ui>/index.html` exists |
| Size / count caps | 20 MB / 200 files | **100 MB / 4000 files** (native code + bundled JS deps are larger; still bounded). Open Q §7. |
| Symlinks | rejected (`lstat`, no follow) | **same** — rejected |
| Permission model | `consentedPermissions` = enforced ceiling | **none** — `declared` is disclosure only; there is no ceiling to enforce |
| Enable default | `enabled: true` | **`enabled: false`** (§1) |
| Record auth | plain JSON | **HMAC-signed (§5)** |

Everything else carries over verbatim: `ID_RE`, no-symlink walk, containment check, stable
sha256-of-{relpath:filehash}, atomic same-fs rename, staged-`.garret` temp dir + `cleanupStaging`,
serialized atomic record writes (`queueRecordWrite`).

## 5. Record authentication (guards the enable flag)

`userData` is writable by any process running as the user. A plain-JSON record means malware with
file-write could drop an extension **and set `enabled: true`**, and Garret would auto-run
full-access code with its inherited TCC grants at next launch — no user in the loop. That defeats §1.

**Mitigation:** HMAC the record with a key held in **macOS `safeStorage`** (Keychain-backed; already
used for secrets — see memory). `mac = HMAC-SHA256(key, canonicalJSON(record-without-mac))`. On load,
recompute and compare; **a record that fails the MAC is treated as `enabled: false`** and flagged
in Manage as "integrity check failed — re-enable to trust." An attacker with mere file-write can't
forge the MAC without the Keychain key (gated by the user's login + Garret's identity). This is
cheap (safeStorage is wired) and it directly hardens the one gate that matters. Honest limits:

- It does **not** protect against a process that can read the Keychain as Garret (already game-over).
- It is **not** anti-tamper for the *code* — that's the sha256 baseline, and neither stops a
  malicious author whose code the user chose to trust. It stops *silent third-party enabling*.

If the critic finds safeStorage-at-first-run bootstrapping fragile (key must exist before first
enable), fallback: generate+persist the key on first `commitInstall`. Flagged as the main §5 risk.

## 6. Consent (honest full-access, not a permission list)

Renderer `NativeConsentDialog` (new; sibling to `sandbox/ConsentDialog.tsx`). Shown when the user
toggles an extension **on** (install itself is silent-safe — it writes files but nothing runs).
Copy states the truth (design doc §1):

> **Device Control** wants to run with **full access to your Mac.**
> It can read and change any file, run any program, and use the network — **there is no sandbox.**
> The author declares it will run: `adb`, `scrcpy`. Network: any.
> *(These are declared by the author, not enforced by Garret.)*
> Only enable extensions from authors you trust.

- **Typed-name confirmation** to break the click-through reflex (design §6 "high-danger"). *All*
  native extensions are full-access, so *all* enables require typing the extension name — not just
  a device class. Cheap, and it's the difference between a reflex click and a decision.
- Toggling **off** is instant (no dialog) and calls `stop()` on any running host + hides the widget.

## 7. Loader / registry replacement

`lane.ts registry()` becomes a disk read of `<userData>/extensions/*/` :
- `listInstalled()` → all extensions + records (for Manage): id, name, version, declared, enabled,
  tampered (sha256 mismatch), macOk (§5).
- `registry()` (what the board loader + `nativeExtStart` use) → **only `enabled && macOk && !tampered`**
  extensions, resolving `nodeEntry`/`uiDir` from the manifest's `node`/`ui`.
- `setNativeUiDir` is called for each **enabled** extension at boot and on enable; the
  `garret-native://<id>/` scheme already keys by id.
- **Dev fixture:** keep `examples/native-hello` but give it a top-level `manifest.json` so it's
  *installable* like any extension (proves the real path). Optionally auto-surface it in the Add
  dialog **only when `!app.isPackaged`** so Phase 2's verification still works without a manual
  install step. No hardcoded enabled extension ships in production.

## 8. UI integration

- **Add dialog** (`AddDialog.tsx`): a distinct **"Extensions — full access"** group, visually
  separated from built-ins and sandboxed widgets, each row with a **red/amber "Full access" badge**.
  Adding one that isn't enabled yet routes through the consent→enable flow before it can be placed.
- **Manage Widgets** (`ManageWidgets.tsx`): native extensions in their own section — show declared
  binaries/network, source, version, enable toggle (→ consent), remove, and the tamper/MAC-fail
  state. Reuse the existing install-from-file / install-from-folder entry points, routed by `kind`.
- **Install entry**: the existing `.garret` open-file path (`open-file` → consent) inspects `kind`
  and shows the native consent variant for `"extension"`.

## 9. IPC surface (new channels, mirror sandbox names)

`nativeExtPlanInstall(folder)`, `nativeExtPlanInstallFromFile(garretPath)`,
`nativeExtCommitInstall(plan)`, `nativeExtCleanupStaging(dir)`, `nativeExtSetEnabled(id, enabled)`
(renderer shows consent *before* calling with `true`), `nativeExtRemove(id)`,
`nativeExtListInstalled()`. The existing `nativeExtList` (board loader) now returns only
enabled+valid extensions. All ids validated with `ID_RE` at the main boundary before touching a path.

## 10. Security invariants (carried + new)

Carried from sandbox: ID_RE (no `..`), no symlinks, containment on every path derived from the
manifest, atomic install, TOCTOU re-hash at commit, host-written authoritative record, staging-dir
allowlist for cleanup. **New for native:** reject `.node`; separate `extensions/` root; default-OFF;
HMAC-authenticated enable flag; typed-name consent; `kind`-routed installer so a native package can
never install through the sandbox path or vice versa.

## 11. Build order

1. `src/main/native/install.ts` (mirror sandbox; deltas §4) + record HMAC (§5) — headless-testable.
2. `registry()`/`listInstalled()` disk loader in `lane.ts` (§7); make `hello` installable (§7).
3. IPC channels (§9) + preload wiring.
4. `NativeConsentDialog` + Manage/Add integration (§6, §8).
5. Verify: install hello from folder → OFF by default → enable (type name) → renders → disable →
   remove; hand-edit record `enabled:true` → rejected (MAC) → shown as integrity-failed.

## 12. Open questions (for the critic)

- **§5 HMAC bootstrap:** safeStorage key lifecycle + what if safeStorage is unavailable
  (Linux/headless dev)? Fallback = generate+persist a key file (weaker; document the downgrade).
- **§4 caps:** 100 MB / 4000 files — right for bundled-JS extensions? Or force authors to bundle to
  a single `.cjs` (esbuild) and keep tight caps? Trade-off: UX vs attack surface / install time.
- **§7 dev fixture** auto-surfacing in dev only — acceptable, or should hello be a real install too?
- Is HMAC-on-record in *this* phase, or deferred to Phase 5 with default-OFF alone holding the line
  until then?
