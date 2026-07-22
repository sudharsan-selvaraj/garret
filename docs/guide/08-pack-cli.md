# The `garret` pack CLI — design

**Status: phases 1–2 landed.** `@garretapp/pack-schema` (the shared rulebook, app refactored onto it)
and `@garretapp/cli` (`init`/`audit`/`build`/`pack`) are built + tested. Remaining: convert the packs
off their `build.mjs` scripts + wire `audit` into CI (phase 3), then publish + `$schema` (phase 4).
This replaces the hand-written `build.mjs` scripts with a first-party CLI that **audits against the
exact rules the app enforces**, then packages — the model Chrome (`web-ext`) and VS Code (`vsce`) use.

## Why

Today every pack author hand-writes esbuild + copy + zip (`garret-widgets/scripts/build.mjs`, and a
`build.mjs` per bundled pack). Two problems:

1. **No pre-flight validation.** A manifest is first checked when the *app installs it* — too late.
   A bad capability, a missing `ui/index.html`, an oversized icon, or a surface without the `windows`
   capability all surface as a failed install, not a build error.
2. **Boilerplate + drift.** Each script re-derives the same bundle/copy logic; there's no scaffold, no
   editor autocomplete, no CI gate.

A CLI fixes both — *if* its validation is the same rulebook the app runs. That parity is the core of
this design.

## Decisions

- **Rulebook home:** a new pure package **`@garretapp/pack-schema`** — the single source of truth,
  imported by both the CLI and the app. The runtime SDK (`@garretapp/sdk`) stays runtime-only.
- **v1 commands:** `init`, `audit`, `build`, `pack`. (`dev`, `publish` deferred to v2.)
- **App parity:** refactor the app's install path to consume `@garretapp/pack-schema` in the same
  effort, so `garret audit` passing ⇒ the app accepts the pack. No mirrored second copy of the rules.

## Architecture

```
                    ┌──────────────────────────────────┐
                    │  @garretapp/pack-schema           │  single source of truth
                    │  • manifest TypeScript types      │  (pure — no fs, no electron,
                    │  • validateManifest(json): Issue[]│   zero runtime deps)
                    │  • capability grammar             │
                    │  • garret.manifest.schema.json    │  (editor autocomplete)
                    └───────────────┬──────────────────┘
                    ┌───────────────┴────────────────┐
        imports     │                                 │     imports
   ┌────────────────▼──────────┐        ┌─────────────▼───────────────┐
   │  @garretapp/cli  (`garret`)│        │  the app (src/main/ext)      │
   │  init · audit · build ·    │        │  manifest.ts → thin wrapper: │
   │  pack                      │        │  validateManifest() + fs     │
   │  = esbuild + zip + schema  │        │  existence + traversal + HMAC │
   └────────────────────────────┘        └───────────────────────────────┘
```

**Split of responsibility** — each layer keeps only what is uniquely its own:

| Concern | Lives in | Why |
|---|---|---|
| Manifest shape, capability grammar, semver, template grammar | `pack-schema` (pure) | Must be identical for CLI + app |
| Bundling (esbuild UI/host), zip, scaffold | `@garretapp/cli` | Build-time only |
| On-disk checks (`ui/index.html` exists, host exists), size/traversal guards, HMAC signing | the app | Runtime/install-only; needs the real files + machine key |

`pack-schema` validates the *declaration*; the CLI and app each add the checks that need the
filesystem. The pure validator is shared, so it can't drift.

## `@garretapp/pack-schema`

Pure ESM, no runtime deps. Exports:

- `Manifest`, `WidgetSpec`, `SurfaceSpec`, `NotifierSpec`, `SettingsField`, `Capability` — the types
  (relocated from `src/shared/types/ext.ts` + `src/main/ext/manifest.ts`, which become re-exports).
- `validateManifest(json: unknown): Issue[]` — pure. `Issue = { level: 'error'|'warn', code, path, message }`.
  Checks: id/publisher format, semver, widget ids unique + single-segment, capability grammar
  (`network:<host>`, `secrets`, `windows`, …), surfaces ⇒ `windows` capability, notifier template
  grammar, `apiVersion` support.
- `CAPABILITIES` — the capability grammar (names + arg shapes + which are host-markers).
- `manifest.schema.json` — a JSON Schema generated from the types, published at a stable URL for
  `"$schema"` autocomplete.

Everything path/filesystem-related (does the `ui` dir exist, is a symlink present, byte sizes) stays
out — those belong to whoever holds the files (CLI or app).

## `@garretapp/cli` (bin: `garret`)

Depends on `@garretapp/pack-schema`, `esbuild`, and a zip lib. Run via `npx @garretapp/cli` or a global
install — same as `vsce`/`web-ext`.

| Command | Behaviour | Analogue |
|---|---|---|
| `garret init` | Scaffold a pack: `garret.manifest.json` (with `$schema`), `ui/<id>/{index.html,main.tsx}`, optional `host/index.ts`, `previews/`, `README.md`, `icon.svg`. | `yo code` |
| `garret audit` | `validateManifest()` + fs checks the app also does: `ui/index.html` present, host present, no `..`/symlink escapes, icon ≤ 512 KB, preview ≤ 2 MB, CSP sanity of UI HTML (no inline `<script>`, no remote `src`). Prints coded issues; **exits non-zero on any error** → CI gate. No build. | `web-ext lint` |
| `garret build` | Runs `audit` first (fail fast). esbuild each `ui/<id>/main.tsx` → `dist/<id>` (self-contained, CSP-safe), bundle `host/index.ts` → `dist/host/index.cjs` (platform node), copy `icon`/`readme`/`previews`. | bundler step |
| `garret pack` | `build` → a **deterministic** (sorted-entry) `<id>.garret`. | `vsce package` → `.vsix` |

**Single vs many.** Default target is the pack in the cwd (like `vsce`). `--all` scans `packs/*` — this
is the drop-in replacement for `garret-widgets/scripts/build.mjs`. Each bundled pack's `build.mjs`
becomes `garret pack`.

## Editor DX + reproducibility (free once the schema exists)

- **Autocomplete:** authors add `"$schema": "https://garretapp.dev/manifest.schema.json"` to the
  manifest and get completion + inline validation in VS Code, like `package.json`.
- **Deterministic `.garret`:** sorted zip entries → stable hashes → reproducible builds and clean
  update diffs. (`.garret` stays a plain zip; no new format.)

## Out of scope (for now)

- **Author signing.** Trust is the host-warning + capability broker, not publisher identity. `.garret`
  stays unsigned; optional signing can be added later without changing this design.
- **`garret dev`** (watch + hot-install) and **`garret publish`** (registry index + GitHub release) —
  v2. The registry's `release.yml` keeps working until `publish` lands.

## Migration (phased, no big-bang)

1. ✅ **Extract `@garretapp/pack-schema`** from `manifest.ts` + `shared/types/ext.ts`; refactor the app
   to consume it. Behaviour-identical — regression-checked against all existing packs (clock, web-view,
   atlassian, google, adb-devices).
2. ✅ **Build `@garretapp/cli`** on the schema: `init`, `audit`, `build`, `pack` (run in dev via `tsx`;
   `pack` output verified against the current `build.mjs` for a vanilla, a React, and a host pack).
3. **Convert** the packs off `build.mjs`; wire `garret audit` into CI.
   - ✅ **Bundled packs** (clock, web-view) → `garret pack`: their `build.mjs` deleted; `pack:bundled`
     builds them via the CLI and is wired into `predev` + `pack:mac`/`pack:dir` (previously the release
     shipped **no** bundled packs — now fixed); `checks.yml` runs the schema test + `garret audit` on
     every push/PR as a required gate.
   - ⏳ **`garret-widgets`** awaits the **published** CLI — a separate-repo CI can't import the in-repo
     package, so this unblocks once phase 4 publishes `@garretapp/cli` + `@garretapp/pack-schema`.
4. **Publish** `@garretapp/pack-schema` + `@garretapp/cli` to npm (like the SDK) + the `$schema`, then
   convert `garret-widgets` (`garret pack --all`) and drop its `scripts/build.mjs`.

## Related

- [Build a widget](04-build-a-widget.md) — the manifest fields the CLI scaffolds + audits.
- [Publishing](06-publishing.md) — today's `.garret` + CI flow the CLI subsumes.
- [Architecture](03-architecture.md) — the capability broker + install path the audit mirrors.
