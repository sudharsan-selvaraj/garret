import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

// One build → pack/ (a clean, installable dir: garret.manifest.json + dist/{ui,host}). This is what
// `create-garret-ext` / `garret dev` will ship; here it's a plain script for the example.
const PACK = 'pack'
rmSync(PACK, { recursive: true, force: true })
mkdirSync(`${PACK}/dist/ui`, { recursive: true })
mkdirSync(`${PACK}/dist/host`, { recursive: true })

// UI: bundle React + the SDK into one self-contained module (CSP is script-src 'self' — no CDNs,
// no code-splitting/modulepreload fetch).
await build({
  entryPoints: ['ui/main.tsx'],
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  minify: true,
  target: ['chrome122'],
  outfile: `${PACK}/dist/ui/app.js`
})
cpSync('ui/index.html', `${PACK}/dist/ui/index.html`)

// Host: bundle to a single CJS entry the utilityProcess forks (node builtins stay external).
await build({
  entryPoints: ['host/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  outfile: `${PACK}/dist/host/index.cjs`
})

cpSync('garret.manifest.json', `${PACK}/garret.manifest.json`)
console.log('built → pack/')
