# Widget packs, isolated settings & distribution

The foundational, can't-cleanly-change-later layer: the **package format**, the **widget identity**,
the **settings scoping**, and the **install/distribution model**. Board layouts, stored settings, and
update checks reference these forever. We lock them now — while the only widgets in existence are our
own examples, so migration is free.

## Locked decisions

1. **Package = pack.** One distributable ("pack") ships **N independently-placeable widgets** + shared
   code. A single-widget widget is just a pack of one.
2. **Identity = publisher-namespaced, source-independent.** Pack id `publisher.pack` (e.g.
   `acme.devtools`); a widget's full id is `packId/widgetId` (e.g. `acme.devtools/adb-devices`). The id
   comes from the **manifest**, not from where it was fetched — the *same* id whether installed from
   git, npm, local, or the registry. This is THE immutable key.
3. **Settings = per-widget isolated + opt-in pack-shared.** Each widget has a private settings/storage
   namespace; a pack may additionally declare one shared namespace (e.g. a single account token used by
   all its widgets). Isolated by default; sharing is explicit and pack-scoped.
4. **Distribution = pre-built artifact; Garret NEVER builds or runs install/build scripts.** The
   distributable contains the manifest + already-built `dist/`. Rationale: (a) security — building
   untrusted code, or running npm lifecycle scripts, is remote code execution; (b) no toolchain
   requirement on the user; (c) the integrity hash covers exactly what runs. `.garret` (slip-safe zip)
   is the artifact; git/npm/registry are just ways to *deliver* it.
5. **Sources are an abstraction; four types first-class.** `local`, `git`, `npm`, `registry` — the
   descriptor shape supports all four now; the registry backend can land later without a format change.
6. **Capabilities are the permission model: declared → consented at install → re-consented when an
   update adds one.** Designed so a future sandbox can *enforce* the declared set (deny-by-default).

## 1. Pack manifest (apiVersion 2)

```jsonc
{
  "apiVersion": 2,
  "id": "acme.devtools",              // pack id — publisher-namespaced, immutable
  "publisher": "acme",                // must prefix id; shown in UI, basis for future verification
  "name": "Acme DevTools",
  "version": "1.2.0",                 // semver; the whole pack versions together
  "widgets": [
    {
      "id": "adb-devices",            // widget key, unique within the pack → full id acme.devtools/adb-devices
      "name": "Android Devices",
      "ui": "dist/adb/ui",            // contained path (no "..", no absolute)
      "host": "dist/adb/host.cjs",    // optional → derives full tier
      "capabilities": ["process", "windows"],
      "defaultSize": { "w": 6, "h": 5 },
      "surfaces": { "device-mirror": { /* … as today … */ } },
      "settings": { "schema": [ /* declarative fields, §3 */ ] }
    },
    { "id": "clipboard", "name": "Clipboard", "ui": "dist/clip/ui", "capabilities": [] }
  ],
  "shared": { "settings": { "schema": [ /* pack-shared fields, e.g. account token */ ] } }
}
```

- **Tier is still derived per-widget** from that widget's capabilities (unchanged rule). A pack can mix
  a full-tier widget and a web-tier widget.
- **`id`/`publisher`/`widget.id` regex** locked: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` per dotted/slashed
  segment; `id` must start with `publisher + "."`. No `..`, no path separators beyond the one `/` we add.
- **Back-compat / migration:** apiVersion-1 single-widget manifests are *rejected with a clear "repack"
  message* rather than silently normalized — there are no third-party v1 packs in the wild, and a fake
  normalization id (`unknown.<id>`) would itself become a permanent id. Our examples are re-authored to
  v2 (one pack, one widget). This is the moment it's free.

## 2. Storage layout & identity mapping

```
<userData>/ext/<packId>/…                     # code: the pack, unpacked once (widgets are subdirs)
<userData>/ext/<packId>/.garret-ext.json      # HMAC-signed install record (per pack)
<userData>/ext-data/<packId>/<widgetId>/       # per-widget isolated state (storage + secrets + settings)
<userData>/ext-data/<packId>/_shared/          # opt-in pack-shared state (only if manifest.shared present)
```

- **Web origin is PER WIDGET (as permanent as the id — locked now).** Today the UI loads from
  `garret://<id>/` — one origin per extension, surfaces as sub-paths. A pack must NOT collapse to one
  origin per pack, or all its widgets would share `localStorage`/IndexedDB/cookies/CSP and UI-side
  isolation breaks. Each widget gets a **distinct origin**: `garret://<packId>.<widgetId>/` (the full id
  as a single host label), and a widget's surfaces stay sub-paths of *its own* origin
  (`garret://<packId>.<widgetId>/~<surfaceId>/`). Browser storage partitioning then enforces UI-side
  isolation for free, complementing the filesystem isolation below.
- One **install record per pack** (`ExtRecord` gains `widgets: WidgetMeta[]` — each with its own
  `capabilities` — plus `source: Source`, `publisher`). The pack installs/updates/uninstalls as a unit.
  **Consent is shown once per pack** (listing which widget wants what), but **capabilities are enforced
  per widget at host launch**: each widget's host receives ONLY that widget's declared caps, never the
  pack union — a benign widget never inherits a sibling's `process`. (`ExtInstallPlan` already carries
  `addedCapabilities`/`codeChanged`; reuse it, extended per-pack.)
- **A host process is still per placed widget instance** (keyed by the guest webContents id), and gets
  `GARRET_EXT_DATA_DIR = ext-data/<packId>/<widgetId>/`. If the pack declares `shared`, it also gets
  `GARRET_PACK_SHARED_DIR = ext-data/<packId>/_shared/`. **Isolation is enforced by what main injects**
  — a widget host can only ever see its own widget dir + (if any) its pack's shared dir; it cannot name
  another pack's or sibling widget's dir. `_shared` is reachable only by hosts of the *same* packId.
- **Secret keys are per widget** (not per pack): `ext.secretKey.<packId>/<widgetId>` for each widget and
  a distinct `ext.secretKey.<packId>/_shared` for the shared namespace. So secret isolation doesn't rest
  on path-injection alone — a path bug can't cross-decrypt. (`keys.ts` today derives per flat id.)
- **Board layout** references the full widget id `packId/widgetId` + instance id. Locking the id scheme
  now means layouts stay valid across updates and re-installs from any source. The board's "add widget"
  catalog expands each installed pack into its N placeable widgets.

## 3. Isolated settings — THREE scopes (reconciled with what exists)

There are now three distinct scopes; the doc must not conflate them (the current `config` is
per-*placement*, which is a different axis from "settings"):

| Scope | Keyed by | Shared across | Use |
|---|---|---|---|
| **per-instance** (EXISTING `config`) | `ext.config.<fullId>.<instanceId>` | nothing | this placement's view state (e.g. which repo this card shows) — **unchanged** |
| **per-widget-type** (NEW) | `ext-data/<packId>/<widgetId>/` | all placements of that widget | the widget's **settings** (account, prefs) |
| **pack-shared** (NEW, opt-in) | `ext-data/<packId>/_shared/` | all widgets in the pack | one shared thing (e.g. an account token) |

- **State** (`ctx.storage` / `ctx.secrets`): per-widget-type by the layout above. Add
  **`ctx.shared.storage` / `ctx.shared.secrets`** (present only when the pack declares `shared`) → the
  `_shared` dir. Concurrent writes from sibling widget hosts to `_shared` use the existing atomic write
  (temp+rename) + per-key last-writer-wins; `_shared` is for low-churn config (tokens), not hot data.
- **Declarative settings** (user-facing): a widget (and the pack `shared`) may declare a **schema**
  (`{ key, label, type: 'string'|'secret'|'number'|'boolean'|'select', … }`). Garret renders an
  **isolated settings pane per widget** (+ one pack-shared pane) and persists values in the
  **per-widget-type** (or `_shared`) namespace — **NOT** per-instance (settings are the widget's, not a
  single card's). Secret-typed fields route to `secrets` (encrypted), never plain config. Existing
  per-instance `config` / `useConfig` is untouched; a widget that wants per-card state still uses it.
- (Widgets can still ship a bespoke settings surface later; the schema is the zero-effort default.)

## 4. Distribution & install

### Source descriptor (persisted in the record)

```ts
type Source =
  | { type: 'local'; path: string }
  | { type: 'git'; url: string; ref: string }        // tag/commit; fetch a prebuilt release asset
  | { type: 'npm'; name: string; version: string }   // registry tarball (prebuilt dist inside)
  | { type: 'registry'; id: string; version: string } // curated index → resolves to a URL + integrity
```

### One unified pipeline (all sources converge)

```
resolve(source) → fetch artifact (.garret / tarball, prebuilt) → verify (slip-safe unpack, structure,
  sha256) → parseManifest (v2) → plan (tier + capability consent) → commit to ext/<packId>/ + record
```

- **local** — today's path (pick a `.garret`).
- **git** — fetch the **prebuilt `dist/` + `garret.manifest.json` committed at a `ref`** (tag/commit),
  via the host's tarball API (e.g. GitHub `codeload` tarball) — NOT a clone-and-build, never executes
  repo code. This is the primary path (most repos won't attach a release asset); a release-attached
  `.garret` asset is also accepted when present. If neither the committed `dist/` nor a release artifact
  is found, install fails with a clear "this repo has no prebuilt Garret pack at <ref>" error. `ref`
  pins the version; update = newer tag/release.
- **npm** — download the **registry tarball** (HTTP GET of `dist.tarball`, i.e. what `npm pack`
  produces); the tarball must carry `garret.manifest.json` + prebuilt `dist/`. **No `npm install`, no
  lifecycle scripts ever run.** Authors commonly `.npmignore` build output — so validate the tarball
  actually contains the manifest's `dist/` paths and **fail with an explicit "dist/ missing from the
  npm tarball (did you publish build output?)"** otherwise. Update = semver via the registry.
- **registry** — a curated index maps `packId@version` → a signed artifact URL + integrity hash. Best
  trust/UX; backend deferred, but the source type + resolver seam exist now.

### Identity, trust & the spoofing question (important)

Because identity lives in the manifest and is source-independent, **any npm package or git repo can
claim any `packId`.** So the trust root differs by source:

- **git / npm / local:** the user is trusting the *URL/name they typed*. The `packId` is a stable
  handle, not a proof of authorship. If two sources claim the same `packId`, install is **refused
  unless the user explicitly replaces** (the record pins the source; a different source for an
  installed id requires confirmation).
- **registry:** the registry vouches for `packId ↔ publisher ↔ artifact` (and later, publisher
  signatures). This is the path to real authenticity.
- **Publisher signing** (author-held key signs the artifact; Garret verifies against a published
  publisher key) is the eventual end state — the manifest carries `publisher` now so signatures can
  bind to it later without a format change.

### Trust model — one `Widget` primitive, warn-on-host (LOCKED, SUPERSEDES tiers/consent)

**Revised decision:** there are **no tiers** (`web`/`full`/`native`) and **no consent flow**. A widget
is just a `Widget`. Installing is always **one-click** — no default-OFF, no re-consent, no danger wall.

- **The only user-facing risk signal is a passive HOST WARNING.** If a widget ships a `host` (raw Node
  → files/network/processes), the marketplace card + install + manager show a badge/notice ("This
  widget can access your computer"). Informational, not blocking.
- **Capabilities remain a functional allowlist the broker enforces** (a UI-only widget can only reach
  what it declared — e.g. `network:api.weather.com`), but they are **not** a consent gate. A widget WITH
  a host is unrestricted at the host (the broker only governs UI-side calls) — that's what the warning
  is for.
- Rationale: same posture as VSCode extensions / npm — the **curated marketplace** (you vouch for the
  index) is the trust root, and the warning sets expectations. Pre-built-only + no install/build scripts
  still hold (that's hygiene, kept). When a sandbox lands later, the warning becomes an enforcement
  boundary with no format change.

Removed by this decision: `ExtTier` + tier derivation, the "require both host + system cap" rule,
install consent / default-OFF / re-consent-on-cap-growth, and the danger-wall UI.

### Versioning & updates

- Record stores `source` + `version` + `sha256`. An update check (per source) surfaces a newer version.
- **Re-consent on capability growth:** if an update's manifest declares capabilities beyond the granted
  set, installation of the update is gated on a fresh consent prompt (a locked safety property — an
  auto-update must never silently escalate from web-tier to spawning processes).
- Updates re-run the full verify pipeline; a failed integrity check aborts, leaving the current version.

## 5. What's locked now vs deferred

- **Locked now (format/contract):** pack manifest v2 (`widgets[]` each with own `capabilities`,
  `shared`, `publisher`); the `packId/widgetId` identity + regex; the **per-widget web origin**
  `garret://<packId>.<widgetId>/`; the `ext/<packId>/` + `ext-data/<packId>/<widgetId>|_shared/` layout;
  **per-widget secret keys**; the pre-built artifact rule; the `Source` descriptor shape (all four
  types); per-pack record + **once-per-pack consent but per-widget capability enforcement at host
  launch**; re-consent-on-cap-growth. **Pack-only versioning** (all widgets version together — a board
  using one widget of a pack updates the whole pack; widgets can't be pinned independently — accepted).
- **Deferred (implementations behind the seams):** the curated registry backend; publisher signing/
  verification; the sandbox that *enforces* declared capabilities; settings-schema richness; auto-update
  cadence/UI. None require a format change to add.

## 6. Risks / review focus

1. **Identity spoofing** across git/npm/local (any source can claim any id) — mitigated by source-pinning
   + explicit-replace + (later) registry/signing. Verify the record refuses a silent source swap.
2. **No code execution on install** — the npm path must never run lifecycle scripts; the git path must
   never clone-and-build. Verify both only fetch + unpack a prebuilt artifact.
3. **Isolation enforcement** — a widget host must not reach a sibling widget's or another pack's data
   dir; `_shared` only within the same pack. All via main-injected paths + `containedPath` checks; no
   guest-supplied path ever concatenated into a data dir.
4. **`_shared` concurrency** — sibling widget hosts writing the same shared key; atomic writes +
   documented last-writer-wins + "config not hot data".
5. **Migration** — re-authoring examples to v2; board layouts referencing old ids (dev-only now, but the
   scheme must be final so it never happens again).
6. **Slip-safe extraction** for npm tarballs + git assets (reuse `unpack.ts` guarantees).
7. **Per-pack consent = union of caps** — is per-pack (not per-widget) consent the right grain? A pack
   with one innocuous widget + one process-spawning widget consents to `process` as a whole. Alternative:
   per-widget capability grant enforced when *that* widget is placed. Flag for the critic.

## 7. Phasing (each phase ends with an adversarial review)

- **P1 — format lock (most important):** manifest v2 parser + `packId/widgetId` identity + **per-widget
  `garret://` origin** + storage/settings layout + per-widget isolation + opt-in `_shared` (SDK
  `ctx.shared`) + per-pack record + **per-widget cap enforcement at host launch** + per-widget secret
  keys + the board catalog expanding a pack into its N placeable widgets. Re-author the examples. Prove
  a multi-widget pack installs, places both widgets, and isolates their settings + client storage.
- **P2 — distribution:** `Source` abstraction + record; git (release asset) + npm (tarball) install +
  update checks, all through the one verify pipeline; source-pinning/replace + re-consent-on-cap-growth.
- **P3 — settings UI:** declarative-schema settings panes (isolated per widget + pack-shared).
- **P4 — registry + signing (later):** curated index resolver + publisher signature verification.
- **Sandbox:** separate backlog; the capability contract here is built to be enforceable by it.
