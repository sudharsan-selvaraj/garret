import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

// One build → pack/ (garret.manifest.json + dist/{ui,host}). ya-webadb is bundled into BOTH the
// host (pure-JS npm deps inline fine) — the real test of the native tier's dependency story.
const PACK = 'pack'
rmSync(PACK, { recursive: true, force: true })
mkdirSync(`${PACK}/dist/ui`, { recursive: true })
mkdirSync(`${PACK}/dist/host`, { recursive: true })

// UI: React bundled into one self-contained module (CSP script-src 'self').
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

// Host: bundle ya-webadb + our code into a single CJS entry the utilityProcess forks. Node builtins
// stay external; the ESM @yume-chan packages are transpiled + inlined by esbuild.
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
