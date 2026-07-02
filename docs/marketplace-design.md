# Garret Widget Marketplace — design (rev 2)

> **⚠️ Predates the tier unification.** This design was written against the old two-tier model
> (sandboxed web tier + native tier). Those tiers are now unified into one extension path —
> **`@garretapp/sdk`**, the single `garret://` scheme, `.garret` packages, tier derived from
> declared capabilities (see [`architecture.md`](./architecture.md)). The marketplace direction
> (npm-backed + signed allowlist, slip-safe extractor, anti-rollback) still stands, but re-read the
> per-tier specifics against the unified install/capability model (`src/main/ext/install.ts` +
> `broker.ts`) before implementing.

Status: **design, pre-implementation.** Two critic rounds applied:
- Round 1 — three-lens panel (windowing · security · distribution): set the direction
  (npm-backed + signed allowlist; Item 4 deferred).
- Round 2 — two adversarial reviews of *this doc* (trust/key-custody · implementation
  realism). Rev 2 folds in their must-fixes: a **freshness/anti-rollback layer**, a **two-tier
  key hierarchy**, a **net-new slip-safe extractor** treated as its own slice, **data-model
  back-compat as slice 0**, CI downgraded to **static validation**, and honest re-estimates.

Build nothing until §3 (trust) and §10 slice 0 are agreed.

## 1. Goal & scope

Let users **discover and one-click-install** community widgets inside Garret, and let authors
**publish** their own — without Garret shipping every widget in-tree. Built-ins stay core;
everything else is a sandboxed third-party widget installed through the existing consent +
integrity path.

Three **sources**, one enforcement path:

| Source | Trust | How it arrives |
|---|---|---|
| **Built-in** | first-party, in-process | shipped in-tree (`builtins.ts`) |
| **Marketplace** | curated + sandboxed + consented | npm package, vouched by a signed allowlist |
| **Sideloaded** | self-trust + sandboxed + consented | a folder or `.garret` file the user picks |

**In scope:** npm-backed marketplace, a signed+fresh curated allowlist, Discover UI,
hostile-safe download/extract/install, update detection, provenance UX, `.garret` packaging,
**widget packs** (one published unit containing multiple related widgets — §6a).

**Deferred:** floating widgets over other apps (Item 4) + per-pixel click-through; per-*author*
signing (v1 signs only the index); ratings/analytics; any hosted backend (we use npm + a git
repo + a CDN, no server).

## 2. Decisions (locked)

- **Backend = npm registry + a curated, signed, fresh allowlist.** Authors `npm publish` a
  `garret-widget-*` package; a `registry.json` we control lists *blessed* `{package, version,
  sha256}` triples. npm gives immutable-per-version tarballs, `deprecate`/yank, a CDN, and
  per-publish provenance (`.github/workflows/publish-sdk.yml` is the template).
- **`.garret` is NOT a marketplace prerequisite.** The installer takes a *directory*
  (`planInstall`/`commitInstall`). Marketplace ships folder-first: download → extract to temp →
  existing `planInstall`. `.garret` is a *sideload convenience* (and a **second**, zip
  extractor — see §10).
- **Item 4 (float over apps) is parked.** Independent of the distribution work.
- **Data-model back-compat is slice 0** (existing installs must not break — §9).

## 3. Trust model

The naive "fetch index, verify its self-listed sha256" is **circular** and was rejected in
rev 1. Rev 2's root is a key pinned in the binary — but a *signature alone proves
authenticity, not recency*, so we add a freshness layer (a scaled-down TUF posture) and a key
hierarchy with a real recovery path.

### 3.1 Artifact integrity (sound, keep)

- The signed index pins each widget as `{npmPackage, version, sha256}`. Because the **index is
  signed**, the `sha256` is attacker-uncontrollable (forging it needs the signing key) — this
  is what makes the post-download hash check meaningful (not circular).
- **Artifact = the exact npm tarball for that version.** Download host is **fixed**
  (`registry.npmjs.org`, jsDelivr `/npm/` as verified-by-hash mirror) and *derived* from
  `{package, version}` — **never a free-form URL from the index** (that was the SSRF hole).
- The sha256 pin is precisely what defends against npm's **unpublish/republish-within-72h** and
  a **compromised npm account**: republished bytes won't match the signed hash → install fails
  closed (an integrity attack degrades to a denial-of-service, the correct trade).
- **No code execution at any point** (verified against the code): `collectFiles` enforces a
  static `ALLOWED_EXT` (html/js/css/json/img/font — no `.sh`/binaries); nothing runs `npm
  install` or any lifecycle script; the tarball's `package.json` is served as an inert `.json`
  file, never interpreted; files are served read-only via `protocol.handle` under the sandbox
  CSP. A `node_modules`/`postinstall` inside a tarball is therefore inert.

### 3.2 Freshness & anti-rollback (NEW — fixes the rev-1 replay hole)

A revocation flag inside a non-expiring signed document is defeatable: a network/CDN/proxy
adversary (the org even runs a jfrog proxy) serves an **old, validly-signed** index that still
blesses a now-revoked version. Signature verifies; kill-switch silently disabled. Fix:

- **Two signed documents.** A small, **always-fetched** `timestamp.json` —
  `{ schemaVersion, seq (monotonic int), signed_at, expires, registrySha256, revoked:
  [{npmPackage, version}] }` — and the larger `registry.json` it pins by hash. (TUF's
  timestamp/snapshot split, minimized.)
- **Client rules (fail closed):**
  - Reject any `timestamp.json` whose `expires` is in the past.
  - Reject any whose `seq` is **lower than the highest seq ever seen** (persisted high-water
    mark) → anti-rollback.
  - Short `expires` (24–72 h); the signer **re-signs on a schedule even when nothing changed**,
    so the freshness window stays tight.
  - **High-water-mark storage + threat boundary:** the persisted `seq` is the whole anti-replay
    defense. It defends against a **network/CDN/proxy** adversary serving an old-but-signed
    timestamp — *that* is the threat model. A **local-filesystem** attacker who can reset the
    watermark file (in `userData`) is explicitly **out of scope**: anyone with local write can
    already tamper installed widget code directly, a strictly higher privilege. Cheap hardening
    (not required): store the watermark via macOS `safeStorage` (already used for secrets) so a
    casual edit can't reset it. State the boundary; don't pretend `seq` resists local tampering.
- **Pin the artifact, NOT the registry URL.** Resolves the rev-1 §8 contradiction: tarballs are
  pinned by `{package, version, sha256}` (immutable); the registry/timestamp are served from a
  path that always returns the *latest* signed copy, with integrity from signature + `seq` +
  `expires`, not URL immutability. (URL-pinning and revocation are mutually exclusive.)

### 3.3 Revocation (single source, fail-closed at load)

- **One canonical list:** `timestamp.json.revoked` at **`{npmPackage, version}` granularity**
  ("revoked beats blessed, always"). Drop the per-entry `revoked?` bool. A bad version can be
  killed without killing the good one.
- **At install:** require a fresh (`seq`/`expires`-valid) timestamp; refuse revoked.
- **At load** (`loadSandboxedWidgets`, today fully offline): check against the **cached** last
  verified timestamp (network not required to load). Define staleness behavior (§3.5).
- **Limitation (must state in UI/docs):** the by-name "Develop" install path (§8) is **not**
  covered by the registry, so revocation does not reach by-name installs. Acceptable because
  that path is gated behind the Develop tab + full unverified-author consent + the sandbox — but
  it must be stated, not implied universal.

### 3.4 Key hierarchy & rotation (NEW — fixes the single-pinned-key dead end)

A single pinned signing key has no recovery path (leak ⇒ every shipped build trusts the
attacker until users install a new binary) and "ship 2 keys (OR)" *doubles* the compromise
surface. Adopt a two-tier scheme:

- **Root keys — TWO hardware tokens (DECIDED, e.g. YubiKeys), 2-of-2 quorum** pinned in the
  binary (AND, not OR: an attacker needs *both* tokens; this *narrows* the surface). Key
  material never leaves the tokens. Their only job: sign a short-lived **delegation** — "these
  signing key(s) are valid until `<expiry>`."
- **Signing key — operationally hot** (may live in CI), signs `registry.json` +
  `timestamp.json`.
- **Recovery:** if the signing key leaks, the roots sign a new delegation that excludes it —
  **and already-shipped builds recover**, because they trust the *roots* and the roots can
  retire a signing key online. No app update needed for signing-key rotation.
- **Root rotation** (rare) still needs an app update; mitigated by the 2-of-2 quorum and a
  documented overlap window. Loss of one root ⇒ re-key via app update; loss of both ⇒ the true
  ceiling (treat root custody accordingly).
- Verification chain: pinned roots → verify delegation (quorum, unexpired) → delegation names
  signing key → verify `timestamp.json` (fresh) → verify `registry.json` (hash matches
  timestamp) → trust entries.

### 3.5 Offline & staleness (NEW — fixes "use cached forever")

- **Install:** requires a fresh, verified timestamp. No network / expired / rolled-back → **no
  install**.
- **Load of already-installed widgets:** use the cached verified registry **only if within a
  max-staleness** (proposed **14 days**). Within window + refresh fails → load normally but show
  a "couldn't verify (cached N days ago)" banner. **Beyond max-staleness → hard-disable
  marketplace widgets** (built-in + sideloaded keep loading). Pick the number explicitly; never
  "trust cached forever."
- **Offline-load is governed by the cached-timestamp staleness clock, NOT the delegation's own
  `expires`.** The delegation (§3.4) is short-lived for *online* freshness; an offline client
  within the 14-day window accepts the last-fetched delegation+timestamp even if the
  delegation's own `expires` has passed (it's already in a degraded, banner-flagged state, and
  hard-disabled at the window edge). Otherwise a client offline longer than the (hours-scale)
  delegation lifetime could never load its widgets — the staleness window would be moot. So:
  online verify rejects an expired delegation; offline-within-window does not. Confirm the two
  lifetimes (delegation `expires` vs 14-day window) so they don't contradict — see §11.

### 3.6 Threat model (rev 2)

| Threat | Mitigation |
|---|---|
| Tampered index (CDN/MITM/bad merge) | signature vs pinned roots → delegation → signing key (§3.4) |
| **Replay of old signed index (revocation bypass)** | `seq` high-water-mark + `expires` fail-closed (§3.2) |
| Malicious bytes w/ matching hash | hash signed; unforgeable without the signing key |
| SSRF via download URL | host fixed (npm), not index-supplied (§3.1) |
| npm unpublish/republish, compromised npm acct | sha256 pin → mismatch fails closed (§3.1) |
| Signing-key compromise | roots retire it via delegation; shipped builds recover (§3.4) |
| **Root-key compromise (both)** | residual ceiling → offline quorum custody; app-update re-key |
| Stale/offline client trusting old blessings | max-staleness hard-disable (§3.5) |
| Hostile-but-consented widget | sandbox caps capabilities (the real blast-radius limit) |
| Blind code-swap on update | re-consent on any code-hash change + author shown (§5) |
| Beacon via metadata image URL | icons derived + `img-src` host-allowlisted, not free-form (§6) |

## 4. Install pipeline

Main owns the entire remote flow; the renderer only says "install blessed entry `<id>`."

```
renderer → invoke marketplace.install(id)         (an id, NOT a path)
main:
  1. verify chain: roots → delegation → timestamp(fresh) → registry → entry
  2. resolve tarball URL from {npmPackage, version} (registry.npmjs.org)
  3. download via the GUARDED net.ts agent (resolved-IP block, https-only, per-redirect
     re-check), with a COMPRESSED-size cap + content-type check + streamed-to-temp
  4. verify sha256(tarball) === entry.sha256                 (non-circular: signed index)
  5. extract .tgz with the slip-safe streaming extractor (§4a) to a MAIN-OWNED temp dir,
     enforcing decompressed-size + file-count caps DURING extraction
  6. planInstall(tempDir)                                    (reuse existing validation + hash)
  7. identity-bind: refuse if id collides with an installed widget of a different KNOWN
     origin/author (today commitInstall blindly rm+renames — this guard is NEW). Legacy rule:
     a prior record with absent/unknown origin (defaults 'sideloaded', no author — §9) is NOT
     treated as a hard conflict; instead require an explicit "replace your sideloaded <name>
     with the marketplace version?" confirmation (the user owns their sideloads). Hard-refuse
     only on marketplace-vs-marketplace author mismatch.
  8. return plan → consent screen → on confirm: commitInstall, writing
     origin='marketplace', npmPackage, author, version into the InstallRecord
  9. cleanup the extract temp dir on success, failure, AND consent-cancel
```

### 4a. The extractor (net-new module, its own slice — not a "port")

The existing `collectFiles` guards operate on an *already-materialized folder* (`readdir` +
`lstat` real inodes). A tar extractor decides safety on a **byte stream before anything hits
disk** — the guards must be **rewritten against the tar model**, the project's single
highest-CVE-risk code:

- Reject non-regular entries by tar `typeflag`: symlink (2), **hardlink (1)**, char/block
  device, FIFO. (`collectFiles` never had to consider hardlinks/devices.)
- Strip exactly one leading `package/` segment (npm convention) — itself an injection surface
  (`package/../../evil`); normalize + containment-check the *declared* path **after** strip.
- Handle GNU/PAX long-name/long-link extension records.
- Stream gzip with a **running decompressed-byte counter that aborts mid-stream** (no
  "extract-then-check" convenience API). `collectFiles`'s 20 MB/200-file caps then run as a
  **second** check on the temp dir.
- **Dependency decision (DECIDED):** use **`tar`** (tar.gz, npm install path) + **`yauzl`**
  (zip, `.garret`) — both pure-JS, no install scripts (satisfy the org `--ignore-scripts`
  policy). **Pin exact versions + vendor-audit** the dep chains, since they parse hostile bytes;
  the sandbox remains the real safety net. (Rejected: hand-rolling tar PAX/GNU + zip safely is
  ~a week each and its own CVE risk.) The guards (typeflag/slip/caps) wrap these parsers; we own
  the policy, the libs own the byte-format parsing.
- Ship the extractor as a **standalone, unit-tested module with adversarial fixtures**
  (tar-slip, symlink, hardlink, device, bomb, `package/` prefix abuse, long-path) **before**
  wiring it to install.

### 4b. Temp-dir lifecycle, concurrency, rollback

- **Two distinct temp dirs:** the **extract** dir (download/unpack) and `commitInstall`'s own
  `.tmp-*` dir, which must live **inside `sandboxWidgetsDir()`** because `rename` is atomic only
  on the same filesystem. The extract dir may be elsewhere, but `planInstall`/`commitInstall`
  read from it — never assume a cross-volume rename. Specify the extract location.
- **Cleanup** the extract dir on success, failure/hash-mismatch, **and consent-cancel** (the
  Cancel button leaves a fully-extracted widget otherwise). `commitInstall` only cleans its own
  `.tmp-*`.
- **Concurrency:** serialize marketplace installs (a simple in-main mutex), and coordinate the
  background update check (§5) so it can't fire mid-install.
- **Rollback:** failures before step 8 commit nothing; just delete temp + return a typed error
  to the renderer.

### 4c. IPC surface (NEW — enumerate, matching `channels.ts` rigor)

- `marketplace:fetchIndex` → verified entries (or a typed signature/freshness error). Used by
  Discover + the update checker.
- `marketplace:install(id)` → runs steps 1–7, returns an `InstallPlan` for consent (tarball is
  on disk during the prompt — see cleanup).
- `marketplace:commit(plan)` → step 8 (or fold into the existing `sandboxInstallCommit`).
- `marketplace:checkUpdates` + a push channel (e.g. `marketplace:updateAvailable`) for the
  badge.
- New `src/main/sandbox/registry.ts`: `loadVerifiedRegistry()`, `verifyChain()`,
  `isRevoked(pkg, version)`, the pinned root keys + delegation logic.

## 5. Updates

`InstallRecord.version` is free-text today, compared nowhere; update logic is **net-new**.

- **Where:** a **main-side** scheduler (renderer can't verify the signed index and isn't always
  mounted) on a cadence with backoff; pushes the badge to the renderer.
- **Join key:** installed records ↔ verified index by `npmPackage` (legacy records lack it —
  §9). Semver-compare; **coerce** invalid/absent versions → "no update; still re-consent on any
  code-hash change" (a malformed version must not suppress updates).
- **No silent code auto-update.** A malicious v2 reusing the same permission set adds zero
  permissions, so the existing `addedPermissions` re-consent never fires. Gate on **any
  code-hash change** (`commitInstall` already computes a stable `sourceHash`) and show **author
  identity** + "code changed since you installed." Detecting this re-runs the full
  download→verify→extract→hash pipeline (not cheap — state it).
- **Revoke at load** uses the **cached** verified timestamp (offline-safe; §3.3/§3.5), not a
  blocking network fetch.
- Default **manual** update. Auto-update may later be opt-in only for unchanged-code cases.

## 6. UX & workflow segregation

**Discover lives in the Add-widget dialog**, not Settings — so *find → install → place* is one
funnel (`src/renderer/src/app/AddDialog.tsx`).

- `AddDialog` today is **fully synchronous** over an in-memory `registry.list()`; it has no
  loading/error/**offline** states, and `buildGroups` assumes every item is a full
  `AnyWidgetPlugin`. Discover entries are **not** plugins (`{id, npmPackage, author, perms,
  screenshots}`) and arrive async over IPC. So Discover is a **structural** change: a
  dual-source model + loading/error/offline UI + a shared consent flow (today `ConsentDialog`
  lives in `ExtensionsManager` and must be extracted/shared). Honest effort **L**, and it
  **depends on the data model (§9) + IPC (§4c)** existing first.
- **Settings → Widgets:** two tabs — **Installed** (manage/enable/remove/update, integrity +
  "tried (blocked)" disclosure — exists) and **Develop** (sideload folder/`.garret`, link to
  `docs/widget-authoring.md`).
- **Provenance badge at placement.** `buildGroups` lumps built-in/marketplace/sideloaded into
  "General". Add a `provenance` field (`builtin | marketplace | sideloaded`) onto the plugin
  (`loader.ts`) and a visible badge ("Unverified author" for marketplace/sideloaded) at
  *placement*, not only at install consent.
- **Metadata images** (icons/screenshots) are **derived + host-allowlisted** (§3.1 paranoia),
  not free-form URLs from the index; rendered as inert `<img>` under the host `img-src`.

## 6a. Widget packs (multi-widget packages)

A single published unit may contain **multiple related widgets** (e.g. an "MDM" pack: Device
List, Compliance, Enrollment). The **pack** is the install / update / remove / **trust** unit;
the contained widgets are what users place. This is the extension-pack pattern.

- **Manifest:** `kind: "pack"` (vs `kind: "widget"` for a single — the umbrella discriminator
  also used by `.garret`), a pack `id` + `name`, and
  `widgets: [{ id, name, defaultSize, minSize?, permissions[], configSchema, capabilities? }]`.
  One pack = one npm package / one `.garret`.
- **Identity — THREE distinct namespaces (a colon-id conflation the critic caught):**
  - **Webview origin / served files / install dir = `<packId>`** — one `SAFE_ID`-clean
    hostname, served at `garret-widget://<packId>/`. It **must not contain `:`** (a URL
    hostname can't, and `SAFE_ID`/`ID_RE` forbid it). The pack's single bundle is served here.
  - **Renderer registry plugin id = `sandbox:<packId>:<widgetId>`** — a Map key **only**
    (`loader.ts`/`registry`), never a URL/hostname/dir; `:` is safe here, and the `sandbox:`
    prefix that `resync`/unregister match on still holds.
  - **Storage partition = per-widget** (`garret-widget-<packId>__<widgetId>`) so pack-widgets
    don't share native web storage, even though they share the pack origin + bundle.
  One install record per pack (dir `sandboxWidgetsDir()/<packId>`); integrity hashes the whole
  pack; install / remove / update operate on the pack as a unit. Both `<packId>` and every
  `<widgetId>` must independently pass `ID_RE`.
- **Isolation — each PLACED instance is its own webview (own OS process + JS realm +
  partition).** "One bundle" means the same `bundle.js` *file* is loaded into each separate
  webview — **not** a shared runtime. Two placed pack-widgets share neither a realm nor a
  partition, so a pack-widget is isolated from its siblings exactly as two unrelated widgets
  are. (Corrects the rev-3 "no new isolation surface, reuse existing threading" wording, which
  was true of the *webview-per-instance mechanism* but glossed the identity/partition split.)
- **Widget selection — host-controlled at the URL, NOT a bridge message (changed from rev 3).**
  The host sets the target in the webview URL —
  `garret-widget://<packId>/?w=<widgetId>` — and `runWidgetPack(map)` reads it from `location`
  at load and mounts that widget *before* `ready`. This is **better than carrying a `widgetId`
  in `init`** (which today is `{instanceId, config, refreshToken}` — adding a field is an SDK
  `HostMessage` wire-format change, AND `init` fires only post-`ready`, after arbitrary guest JS
  has run, letting the *guest* pick): the URL is set by the host before the bundle loads, so the
  host decides what's served. The guest is untrusted regardless — if it ignores `?w=` and mounts
  a sibling, the host-side `BridgeHost` still enforces the **placed** widget's permission ceiling
  and host-set `nsKey`, so it's contained (no escalation; only mis-rendered chrome — within the
  already-accepted unverified-author model). Only widget-side addition: the `runWidgetPack` SDK
  entry reading the URL selector. **No `HostMessage`/`init` change.**
- **Per-widget enforcement — the mechanism exists, the PLUMBING is net-new (corrects "+S–M").**
  `BridgeHost` already enforces a per-instance `consentedPermissions` (sound). But today
  `listSandboxedWidgets` returns **one `InstalledWidget` per directory** and
  `makeSandboxedPlugin(id, m, perms)` is strictly **1:1** with one flat permission set. Packs
  require an explicit **1→N fan-out, located in `listSandboxedWidgets`**: read the pack record's
  `widgets` map and emit **N `InstalledWidget` rows from one dir**, each with its `manifest`
  slice + `consentedPermissions` slice; `loadSandboxedWidgets` then calls `makeSandboxedPlugin`
  N times. `makeSandboxedPlugin`/`SandboxWidget` must thread **three** ids: origin/src =
  `<packId>`, partition = `garret-widget-<packId>__<widgetId>`, identity (perms + `nsKey`) = the
  per-widget compound. The `InstalledWidget` type (single `enabled`/`tampered`/perms) gains an
  N-widget representation (or the list expands to N rows) — a type change rippling to
  `loader.ts`, `ExtensionsManager`, `AddDialog`. **This is real work, not reuse.**
- **Storage — PER-WIDGET isolation (decision), two layers.** `sdk.storage` is host-namespaced
  `nsKey(<packId>:<widgetId>)` (the `widgetId` handed to `BridgeHost` is the per-widget compound
  — a plain string for `nsKey`, never a URL; `ID_RE` forbids `:` in components so the
  NUL-joined key can't collide), AND the per-widget partition isolates raw
  `localStorage`/IndexedDB. No `services.connect` (host-only) ⇒ no shared credential ⇒ no
  pack-shared storage in v1 (possible future opt-in).
- **Consent — pack-level, ALL-OR-NOTHING; "least privilege" is an ENFORCEMENT property, not a
  consent lever (honest framing).** Consent is once at install: the screen shows a per-widget
  permission **breakdown** (disclosure) and the **union**, but the user's only choice is
  install / don't-install the *pack* — they can't decline widget B's `network:` while keeping
  A. What per-widget least-privilege buys is **enforcement** (each webview capped to its own
  slice, so a benign widget can't use a sibling's grant), not per-widget consent. Do **not**
  imply per-widget toggles (they'd conflict with pack-level enable/disable). A blessed pack
  declaring a broad `network:` host is the human reviewer's call at re-bless time.
- **Integrity / install / remove — pack unit.** One record per pack, one sha256 over the whole
  dir (`verifyIntegrity` already hashes a dir). `tampered` is **pack-level** — a tampered pack
  marks all N unavailable together. Install/remove/update + enable/disable are pack-level in v1
  (per-widget toggle later).
- **Discover / UX:** one Discover card ("Mobile Device Management — 5 widgets") with per-widget
  disclosure; installing registers all N, grouped under the pack name (`buildGroups`); removing
  removes all N (→ "removed" placeholder).
- **Registry entry:** one `{npmPackage, version, sha256}` for the pack; the entry lists
  contained widget ids + each one's declared permissions (Discover display + consent breakdown).
- **Caps:** 20 MB / 200 files apply to the whole pack dir — plausibly tight at N≈5; raise for
  `kind:"pack"` if needed.
- **Data model:** a pack `InstallRecord` carries `kind:'pack'` + a `widgets` map
  `{ widgetId → { consentedPermissions, attemptedBlocked } }` instead of the flat fields.
  Slice 0 (§9): absent `kind` ⇒ `'widget'`.
- **Effort: M–L** (not "+S–M") — the 1→N fan-out + `InstalledWidget`/IPC shape change +
  three-id threading + `runWidgetPack`/URL-selector, spread across slices 0/4/5. Single-widget
  stays the default path and is unaffected.

## 7. Security requirements (gate before shipping)

1. Signed chain: **quorum roots (pinned) → delegation → signing key**; verify before trusting
   any entry (§3.4).
2. **Freshness:** signed `timestamp.json` with `seq` + `expires`; client high-water-mark +
   fail-closed (§3.2). Max-staleness hard-disable at load (§3.5).
3. **Revocation** at `{package, version}`, single list, revoked-beats-blessed; by-name installs
   explicitly uncovered (§3.3).
4. **Hostile-safe download/extract** (§4/§4a): guarded agent, fixed host, compressed +
   decompressed caps, slip/symlink/hardlink/device-safe streaming extractor.
5. **Main owns staging; identity-bind**; no cross-author id takeover (§4 step 7).
6. **No silent code update**; re-consent + author on any code change (§5).
7. Host CSP already hardened (dev+prod, `frame-src`, sandbox CSP preserved). Metadata images
   derived + allowlisted; never HTML-interpolated or framed (§6).
8. Provenance field + badge at placement (§6).

## 8. The `garret-widgets` repo

- **`registry.json`** (blessed `{id, npmPackage, version, sha256, author, permissions[],
  categories[], minApiVersion}`) + **`timestamp.json`** (§3.2) + a **`delegation`** doc
  (§3.4). registry/timestamp served via jsDelivr `/gh/` always-latest (integrity from the
  chain, not URL immutability).
- **Submission = PR.** **CI = static validation only** (feasible on a plain runner): npm
  package resolves at the pinned version; unpack **via the same net-new tar extractor as
  production install (§4a), not `collectFiles`** (which never sees a tarball), then run its
  guards; schema-validate; lint declared `network:`/`service:` permissions; confirm sha256. A
  webview-based "runtime smoke-test" is **structurally unable** to catch runtime abuse (a
  widget can detect headless / time-bomb / gate on a remote flag) and needs Electron + xvfb in
  CI — so it is **manual-review-time / aspirational defense-in-depth, NOT a merge gate or trust
  signal.** The real gate is the human re-bless + the sandbox.
- **Signing** (delegation + timestamp + registry) uses the maintainer-held keys (roots offline;
  signing key may be a CI secret) — never committed.
- **Naming:** `garret-widget-<name>` (unscoped; `@garret` unavailable; we already own
  `garret-core`/`garret-widget-sdk`). The **allowlist**, not the name, gates Discover, which
  neutralizes typo/namespace squatting for discovery. Develop users may install any
  `garret-widget-*` by name (full consent + sandbox; **not** revocation-covered — §3.3).
- **Curation policy:** the human reviewer must scrutinize declared `network:` hosts (a blessed
  widget declaring `network:*.attacker.com` is consented+sandboxed but the reviewer is the only
  gate on whether that host should be allowed at all).

## 9. Data model & back-compat (SLICE 0 — do first)

Existing installs have `.garret-install.json` records with **no `origin`/`author`/`npmPackage`**
and a free-text `version`. New fields must be **optional with safe defaults**, or
`listSandboxedWidgets` (which silently `continue`s on a record it can't handle) will make
pre-existing widgets **vanish** from the Installed tab + board.

- `origin?: 'marketplace' | 'sideloaded'` → **default `'sideloaded'`** when absent (every legacy
  record *was* a folder sideload — correct).
- `kind?: 'widget' | 'pack'` → **default `'widget'`** when absent (every legacy record is a
  single widget). A `'pack'` record carries a `widgets` map (per-widget consentedPermissions +
  attemptedBlocked) instead of the flat fields — §6a.
- `author?`, `npmPackage?` → optional, undefined for legacy/sideloaded.
- `version`: coerce invalid/absent → treated as "no update available; re-consent on code-hash
  change." Never throw on bad semver.
- `listSandboxedWidgets` must **keep defaulting absent fields** (it already does for
  `version`/`source`) — never make a field required.
- Plugin/`InstalledWidget` gains `provenance` for the badge (§6).
- The signed-entry shape + pinned root keys live in `src/main/sandbox/registry.ts`.

## 10. Build order (rev 2 — honest effort)

| # | Slice | Effort | Notes |
|---|---|---|---|
| **0** | **Data-model back-compat** | **S** | Optional fields + defaults + version coercion. Prereq for everything; was missing in rev 1. |
| 1 | CSP `img-src 'self'` relax | S | Raster widget skins (host CSP already hardened). |
| 2 | **Signed-chain verify** (`registry.ts`: roots→delegation→timestamp→registry, freshness/anti-rollback) behind `marketplace:fetchIndex` | **M** | De-risk the crypto independently; no download yet. |
| 3 | **Slip-safe extractor** (tar.gz) as a standalone unit-tested module | **M–L** | Dependency decision (add `tar` vs hand-roll); adversarial fixtures. Highest-CVE code. |
| 4 | **Network install** (guarded download → extractor → temp → `planInstall`/`commitInstall`, identity-bind, cleanup, IPC) | **L** | Wires 2+3 to install. |
| 5 | **Discover in AddDialog** + provenance badge | **L** | Sync→async, dual-source, shared consent. Depends on 0/4 + part of 6. |
| 6 | **Update detection** (main scheduler, semver+coerce, revoke-at-load cache, code-change re-consent) | **M–L** | New scheduler + push channel. |
| 7 | `.garret` packaging (sideload; **second/zip** extractor) | **M** | Not "S" — zip ≠ tar. |
| 8 | Render track: bare/transparent mode (Item 5 minus over-apps) | — | Orthogonal; defer. |

Smallest honest end-to-end value slice = **0 → 2 → 3 → 4** + a minimal Discover (5). Rev 1's
"#2 + minimal #3" was too big (it bundled extractor + signing + the async-AddDialog rewrite).

**Widget packs (§6a)** layer across existing slices (not a new slice), but the critic round
re-priced them: the 1→N fan-out in `listSandboxedWidgets`, the `InstalledWidget`/IPC shape
change, the three-id threading in `makeSandboxedPlugin`/`SandboxWidget`, and the
`runWidgetPack` SDK entry + URL selector are **real plumbing, not reuse**. Net: **+M–L** —
slice 0 (`kind` + per-widget consent map + the InstalledWidget shape), slice 4 (fan-out +
three-id threading + `runWidgetPack`), slice 5 (one Discover card → N widgets). Single-widget
remains the default, unaffected path. **Defer packs until single-widget is shipped end-to-end.**

## 11. Open questions (trimmed — most now answered in §3)

- **Root key custody: DECIDED — two hardware tokens, 2-of-2 quorum.** Remaining: the precise
  overlap procedure for a (rare) root rotation via app update.
- **Extractor dependency: DECIDED — `tar` + `yauzl`, pinned + vendor-audited** (§4a).
- **Max-staleness number** (§3.5 proposes 14 days), the timestamp `expires` window (24–72 h),
  and the **delegation lifetime** — confirm all three are mutually consistent. Proposed
  resolution (§3.5): online verification rejects an expired delegation, but offline-load within
  the 14-day staleness window accepts the last-fetched delegation regardless of its own
  `expires`. Working defaults to confirm: **`expires` 48 h, max-staleness 14 days, delegation
  ~30 days**. Slice 2 (online verify only) is **unblocked**; these numbers are needed by the
  **load path (slice 4+)**, not by slice 2 — so this is not a slice-2 blocker (reconciles §10).
- **Extractor dependency** (§4a): add `tar`/`yauzl` (supply-chain surface in the hostile path)
  vs hand-roll (time). **Decision needed before slice 3.**
- **Icon/screenshot hosting** (§6): in-repo via jsDelivr `/gh/` vs from the tarball; size/format
  policy.

## 12. References
- Install/enforcement: `src/main/sandbox/{install,session,protocol,net}.ts`,
  `src/renderer/src/sandbox/{BridgeHost,SandboxWidget,loader,ExtensionsManager}.tsx`
- Placement funnel: `src/renderer/src/app/AddDialog.tsx` · IPC: `src/shared/ipc/channels.ts`
- Author guide: `docs/widget-authoring.md` · Sandbox internals: `docs/sandbox-design.md`
- npm publish template: `.github/workflows/publish-sdk.yml`
</content>
