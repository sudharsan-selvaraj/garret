# Garret Widget Marketplace — design

Status: **design, pre-implementation.** Reviewed by a three-lens staff panel (native
windowing · security/supply-chain · distribution). This doc captures the decisions that
survived that review. Build nothing until the **trust model** (§3) is settled.

## 1. Goal & scope

Let users **discover and one-click-install** community widgets from inside Garret, and let
authors **publish** their own — without Garret shipping every widget in-tree. Built-ins stay
core; everything else is a sandboxed third-party widget installed through the existing
consent + integrity path.

Three widget **sources**, one enforcement path:

| Source | Trust | How it arrives |
|---|---|---|
| **Built-in** | first-party, in-process | shipped in-tree (`builtins.ts`) |
| **Marketplace** | curated + sandboxed + consented | npm package, vouched by a signed allowlist |
| **Sideloaded** | self-trust + sandboxed + consented | a folder or `.garret` file the user picks |

**In scope:** npm-backed marketplace, a signed curated allowlist, Discover UI, hostile-safe
download/install, update detection, provenance UX, `.garret` packaging for sideload.

**Out of scope (deferred):** floating widgets over other apps (Item 4) and per-pixel
click-through; per-*author* cryptographic signing (only the *index* is signed in v1 — see
§3); ratings/analytics; a hosted backend service (we use npm + a git repo + a CDN, no server).

## 2. Decisions (locked)

- **Backend = the npm registry + a curated, signed allowlist.** Authors `npm publish` a
  `garret-widget-*` package; a small `registry.json` we control lists the *blessed* packages.
  npm gives versioning, immutable per-version tarballs, `deprecate`/yank, a CDN, and
  per-publish provenance — and we already publish `garret-core`/`garret-widget-sdk` to npm
  with provenance (`.github/workflows/publish-sdk.yml` is the template).
- **`.garret` is NOT a marketplace prerequisite.** The installer already takes a *directory*
  (`planInstall(srcDir)` / `commitInstall` in `src/main/sandbox/install.ts`). The marketplace
  ships folder-first: download → unpack to a temp dir → existing `planInstall`. `.garret` is a
  *sideload convenience* only.
- **Item 4 (float over other apps) is parked.** It needs a per-widget-window refactor + a
  security review; it does not gate any of the distribution work.

## 3. Trust model (the part the review broke — read this first)

The naive plan — "fetch `registry.json`, read `{downloadUrl, sha256}`, download, verify the
hash against the index" — is **circular**: the bytes and the hash come from the same document
over the same channel, so anyone who controls the index (a compromised maintainer token, a
merged-but-malicious PR, a CDN/edge compromise) just lists a matching hash for malicious bytes
and verification passes. sha256-from-the-index proves only *transit integrity*, not publisher
honesty.

**Fix — anchor the trust root to a key pinned in the Garret binary:**

1. **The allowlist is signed.** `registry.json` has a detached signature
   `registry.json.sig` (ed25519 / minisign). Garret ships the maintainer's **public key
   compiled into the app**. Main verifies the signature before trusting *any* entry. An
   attacker who alters the index can't re-sign it without the private key.
2. **Each entry pins an exact, reviewed version + its hash:**
   `{ id, npmPackage, version, sha256, author, permissions[], categories[], iconUrl,
   screenshots[], blessed: true, revoked?: bool, minApiVersion }`. Because the *index* is
   signed, the `sha256` is now an attacker-uncontrollable assertion — it's vouched by the
   pinned key, not self-referential. That makes the post-download hash check meaningful.
3. **Artifact = the npm tarball for that exact version.** npm tarballs are immutable per
   version and carry provenance. The download host is therefore *fixed*
   (`registry.npmjs.org` / jsDelivr `/npm/`), derived from `{npmPackage, version}` — **never a
   free-form `downloadUrl` from the index** (that would reintroduce SSRF).

Threat model after this:

| Threat | Mitigation |
|---|---|
| Tampered index (CDN/MITM/bad merge) | signature check against pinned key (§3.1) |
| Malicious bytes with matching hash | hash is signed; can't forge without the key |
| SSRF via download URL | host is fixed (npm), not index-supplied |
| Compromised **maintainer signing key** | residual — rotate-key + revocation list (§8); the real ceiling |
| Hostile-but-*consented* widget | the sandbox caps capabilities (this is the real safety net) |
| Blind code-swap on update | no silent code update; re-consent on any code change (§5) |

> The runtime sandbox (isolation + the `net.ts` SSRF gate + the consent-ceiling install) is
> genuinely strong and is the impact-limiter. The marketplace must supply **provenance** the
> sandbox can't: *who* wrote this and *did the code change*. "The sandbox is the safety net"
> is true for blast radius, false for "is this widget trustworthy."

## 4. Install pipeline

Main owns the entire remote flow; the renderer only says "install blessed entry `<id>`."

```
Discover (renderer)
  └─ invoke: marketplace.install(id)         ← an id, NOT a path
main:
  1. load + verify signed registry  → entry{npmPackage, version, sha256, author, perms}
  2. resolve tarball URL from {npmPackage, version} on registry.npmjs.org
  3. download via the GUARDED undici agent (reuse net.ts: resolved-IP block, https-only,
     per-redirect re-check), with a COMPRESSED-size cap + content-type check
  4. verify sha256(tarball) === entry.sha256        ← now non-circular (signed index)
  5. extract .tgz to a main-owned temp dir with a SLIP-SAFE extractor
     (port collectFiles' lstat/containment/symlink/extension guards; cap DECOMPRESSED
     size + file count DURING extraction, not after)
  6. planInstall(tempDir)            ← reuse existing validation + hashing
  7. bind identity: refuse if id collides with an installed widget of a different
     origin/author (block takeover of another widget's dir — commitInstall does rm+rename)
  8. consent screen (existing) → commitInstall, writing origin='marketplace',
     npmPackage, author into the InstallRecord
```

Hostile-download requirements (security review, non-negotiable):
- Reuse `net.ts`'s guarded agent — do **not** write a fresh `undiciFetch` (it would bypass the
  SSRF defenses).
- https-only; host allowlisted to the npm registry / CDN.
- Cap **compressed** size before/while reading **and** **decompressed** size during
  extraction (zip/tar-bomb). The existing 20 MB / 200-file caps apply to the *expanded* tree.
- Slip-safe extractor for **both** archive types: npm tarballs are `.tgz` (gzip+tar);
  sideloaded `.garret` is a zip. Both need per-entry containment + symlink rejection.
- `session.ts`'s `onBeforeRequest` cancels every non-`garret-widget:` request on widget
  partitions — so the download must run in **main**, never in a sandbox session.

## 5. Updates

`InstallRecord.version` is free-text today and compared nowhere; update logic is **net-new**.

- **Detection:** background-compare installed `record.version` to the signed registry's pinned
  version (semver). Show an "update available" badge in the Installed tab.
- **No silent code auto-update.** A malicious v2 that keeps the *same* permission set
  (reusing its one consented `network:` host + `storage`) passes integrity and adds zero
  permissions — the existing re-consent (which fires only on *added* permissions) would never
  prompt. So: **prompt on any code change**, showing **author identity** and a "code changed
  since you installed" notice — not just on new permissions.
- **Curation = version review.** The signed registry pins a *reviewed* version; a new version
  appears to users only after the maintainer re-blesses (re-reviews + bumps + re-signs). This
  keeps the maintainer as the code-review gate (the point of "under my supervision") at the
  cost of update latency. Per-author signing (so trusted authors can ship updates without
  re-review) is the documented scaling path — deferred.
- **Revoke/yank:** the signed registry carries a `revoked` flag (and we honor npm
  `deprecate`). Garret checks it at install **and at load**, and surfaces "this version was
  withdrawn." This is the kill-switch the self-publish model needs.
- Default is **manual** update (user clicks). Auto-update may later be opt-in *only* for
  unchanged-code/permission cases.

## 6. UX & workflow segregation

**Discover lives in the Add-widget dialog, not Settings.** Installing from a Settings tab and
then separately opening the Add dialog to place it is a broken funnel. Discover sits in
`AddDialog` (`src/renderer/src/app/AddDialog.tsx`) so *find → install → place* is one flow.

- **Add widget dialog:** existing built-in groups **+ a "Discover" section** (search,
  categories, screenshots, per-entry declared permissions). Install → existing consent →
  immediately placeable in the same dialog.
- **Settings → Widgets:** two tabs — **Installed** (manage / enable / disable / remove /
  update, integrity + "tried (blocked)" disclosure — exists today in `ExtensionsManager.tsx`)
  and **Develop** (sideload a folder or `.garret`, link to `docs/widget-authoring.md`).

**Provenance must be visible at placement time.** Today `buildGroups` (`AddDialog.tsx`) groups
by `serviceId`, else "General" — so built-in, marketplace, and sideloaded widgets all land in
one undifferentiated bucket. Add a `provenance` field (`builtin | marketplace | sideloaded`)
carried onto the plugin (`loader.ts` `makeSandboxedPlugin`) and a **badge** on each widget
item (e.g. "Unverified author" for marketplace/sideloaded). The consent screen already says
unverified — but that's at install; the badge must also show at *placement*.

## 7. Security requirements (consolidated — gate before shipping)

1. **Sign the allowlist; verify against a key pinned in the binary** (§3). Non-negotiable.
2. **Treat the download as hostile** (§4): guarded agent, https-only, host allowlist,
   compressed + decompressed caps, content-type, slip-safe extractor.
3. **No silent code auto-update**; re-consent + author identity on any code change (§5).
4. **Main owns the staging path** for remote installs; **bind install to registry identity**
   and refuse cross-author id takeover (§4 step 7).
5. **Provenance everywhere** + visible badge at placement (§6).
6. **Host CSP** already hardened (`src/main/index.ts`: dev+prod, `frame-src` set, sandbox CSP
   preserved). Marketplace metadata (names/descriptions/icons) must be rendered as **inert
   text + `<img>`** (governed by `img-src`), **never** interpolated as HTML or framed.

## 8. The `garret-widgets` repo

- **`registry.json`** — the curated allowlist (the entry schema in §3.2) + a top-level
  `revoked: []`. **Signed** → `registry.json.sig`. Served via jsDelivr `/gh/` from a **pinned
  tag/commit** (immutable), not a mutable `@main` (so a force-push can't silently change what
  clients see between signature checks).
- **Submission = PR.** CI validates each entry: the npm package resolves at the pinned
  version; unpack the tarball and run the same allowlist (`collectFiles`) guards; schema +
  size + permission sanity; a headless sandbox smoke-test (loads in a webview, asserts no
  guard violations). Maintainer reviews → merges.
- **Signing step** regenerates + signs `registry.json` (maintainer-held key; never in repo).
- **Naming:** convention `garret-widget-<name>` (unscoped — `@garret` is unavailable; we
  already own `garret-core`/`garret-widget-sdk`). The allowlist — not the name — is what makes
  a package appear in Discover, which neutralizes typo/namespace squatting for *discovery*.
  Develop/advanced users may install any `garret-widget-*` by name (with the full
  unverified-author consent + sandbox).

## 9. Data-model changes

`InstallRecord` (`src/main/sandbox/install.ts`) gains:
```ts
origin: 'marketplace' | 'sideloaded'   // 'builtin' never has a record
npmPackage?: string                    // marketplace only
author?: string                        // from the signed entry; shown on install/update
// version is now semver-compared, not just stored
```
`InstalledWidget` / the plugin manifest (`loader.ts`) gains `provenance` for the badge.
The signed-entry shape and the pinned public key live in a new `src/main/sandbox/registry.ts`.

## 10. Build order (vertical slices — value first, not horizontal layers)

1. **Quick wins (mostly done).** `img-src 'self'` CSP relax for raster widget skins (host CSP
   already hardened in this branch). **S**
2. **Trust core + network-install slice.** `registry.ts` (fetch + **verify signed index**),
   guarded download, slip-safe extract → temp → existing `planInstall`/`commitInstall`, with
   identity binding. Folder-first; no `.garret`. **M–L** (the signing + hostile-download work
   is the bulk).
3. **Discover in the Add dialog** + provenance field & badge. **M**
4. **Update detection** — semver compare, badge, changelog field, revoke/yank honored;
   code-changed re-consent. **M**
5. **`.garret` packaging** — sideload convenience (zip + the slip-safe extractor from #2). **S**
6. **Render track (orthogonal):** bare/transparent render mode (Item 5 minus over-apps).

Smallest end-to-end value slice = #2 + a minimal #3: *open Add widget → Discover → pick →
consent → installed & placeable, zero local files*. Ship that before polishing.

## 11. Open questions

- **Signing key custody + rotation.** Where does the maintainer private key live (local-only
  vs a CI secret)? How is the *pinned public key* rotated in the app without bricking old
  builds (ship 2 valid keys during overlap)?
- **CI smoke-test fidelity.** How faithfully can headless CI exercise a widget enough to catch
  abuse before merge, given the sandbox needs a webview + bridge?
- **Update bottleneck vs. autonomy.** Is maintainer-re-blesses-every-version acceptable at
  small scale, and what's the trigger to invest in per-author signing?
- **Icon/screenshot hosting** for Discover (host-UI images, not sandbox): in-repo via jsDelivr
  vs. the npm package — and a size/format policy.

## 12. References
- Install/enforcement: `src/main/sandbox/{install,session,protocol,net}.ts`,
  `src/renderer/src/sandbox/{BridgeHost,SandboxWidget,loader,ExtensionsManager}.tsx`
- Placement funnel: `src/renderer/src/app/AddDialog.tsx`
- Author guide: `docs/widget-authoring.md` · Sandbox internals: `docs/sandbox-design.md`
- npm publish template: `.github/workflows/publish-sdk.yml`
</content>
