# 6 · Publishing

[← Host packs](05-host-packs.md) · Next: [SDK reference →](07-sdk-reference.md)

Packs are distributed as `.garret` files (zips) served from **GitHub Release assets**, with a
`index.json` registry the app fetches. The first-party registry is
[`garret-widgets`](https://github.com/sudharsan-selvaraj/garret-widgets); anyone can host their own
with the same shape.

## Registry repo layout

```
garret-widgets/
  index.json                 # the marketplace catalogue (hand-maintained)
  packs/<pack>/              # source: garret.manifest.json + ui/ (+ host/, shared/)
  scripts/build.mjs          # bundles every pack → dist/<id>.garret
  .github/workflows/release.yml   # CI: build + attach .garret to the "packs" release
  .npmrc                     # pins registry.npmjs.org (public) for @garretapp/sdk, react, lucide
```

## Build

`scripts/build.mjs` (esbuild) turns each `packs/<pack>/` into `dist/<id>.garret`:

- For each `ui/<widget>/` with a **`main.tsx`** → bundle to `app.js` (ESM, minified, `script-src 'self'`);
  imported CSS is emitted as `app.css`. Vanilla widgets (no `main.tsx`) are copied as-is.
- If the pack has a **`host/index.ts`** → compile to `dist/host/index.cjs` (`platform:node`, cjs).
- Zip `garret.manifest.json` + `dist/**` into `dist/<id>.garret`.

```bash
npm ci
npm run build        # → dist/*.garret
```

Verify an artifact before shipping:

```bash
unzip -l dist/acme.tasks.garret     # → garret.manifest.json, dist/list/{index.html,app.js,app.css}
```

## Release (CI)

`release.yml` runs on pushes that touch `packs/**` (or the builder). It `npm ci`, `node scripts/build.mjs`,
then uploads `dist/*.garret` to the **`packs`** GitHub Release (`gh release upload packs dist/*.garret --clobber`).

So the flow to ship a change is just: **edit the pack → bump its manifest `version` → commit + push.**
CI rebuilds and re-attaches the asset.

## The registry index

`index.json` is a hand-maintained array the app reads to populate the marketplace. One entry per pack:

```json
[
  {
    "id": "acme.tasks",
    "name": "Tasks",
    "publisher": "acme",
    "description": "Your open tasks.",
    "version": "1.0.0",
    "url": "https://github.com/acme/garret-widgets/releases/download/packs/acme.tasks.garret",
    "hasHost": false
  }
]
```

Bump `version` here in lockstep with the manifest — the app shows **Update → vX** when the installed
version differs. Set `hasHost: true` for packs that ship a host (drives the install warning).

## Install / update flow (app side)

1. **Manage widgets** fetches `index.json` (`ext:marketplace`).
2. **Install** downloads the `.garret` from `url` and runs `install.ts` (unzip → validate manifest →
   sign a local record). Host packs show the "runs code" notice first.
3. **Update** re-installs when `index.json.version !== installedVersion`.

## Publishing the SDK

`@garretapp/sdk` is a normal public-npm package (in this app repo under `packages/sdk`). To cut a
release: bump `packages/sdk/package.json` `version`, then

```bash
cd packages/sdk
npm publish --userconfig ~/.npm-ss --registry https://registry.npmjs.org --access public
```

The `--userconfig`/`--registry` override is required because the default registry is a corporate
mirror — publish (and packs' `npm ci`) must resolve from **registry.npmjs.org**, or CI 401s.

> **CI gotcha:** if you `npm install` a dep with the default registry, `package-lock.json` picks up
> the corporate mirror's URLs and CI `npm ci` fails. Always install with `--registry https://registry.npmjs.org`
> in these repos, and check `grep -c jfrog package-lock.json` is `0`.

Next: [SDK reference →](07-sdk-reference.md)
