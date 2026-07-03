import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

// The scrcpy server (~66KB, Apache-2.0) runs ON the device. Version MUST match SCRCPY_VERSION in
// host/adb/mirror.ts (the server verifies its launch version arg). Fetched on demand, not vendored.
const JAR = 'host/assets/scrcpy-server.jar'
const JAR_URL = 'https://github.com/Genymobile/scrcpy/releases/download/v3.3.1/scrcpy-server-v3.3.1'
if (!existsSync(JAR)) {
  console.log('fetching scrcpy-server.jar (v3.3.1)…')
  const res = await fetch(JAR_URL)
  if (!res.ok) throw new Error(`failed to fetch scrcpy-server.jar: ${res.status}`)
  mkdirSync('host/assets', { recursive: true })
  writeFileSync(JAR, Buffer.from(await res.arrayBuffer()))
}

// One build → pack/ (garret.manifest.json + dist/{ui,host}). ya-webadb is bundled into BOTH the
// host (pure-JS npm deps inline fine) — the real test of the native tier's dependency story.
const PACK = 'pack'
rmSync(PACK, { recursive: true, force: true })
mkdirSync(`${PACK}/dist/ui`, { recursive: true })
mkdirSync(`${PACK}/dist/mirror`, { recursive: true })
mkdirSync(`${PACK}/dist/host`, { recursive: true })

// UI surfaces: the list (primary) + the mirror (floating). Each bundled self-contained (CSP
// script-src 'self'). The mirror pulls in the WebCodecs scrcpy decoder.
for (const [entry, dir] of [
  ['ui/main.tsx', 'ui'],
  ['ui/mirror/main.tsx', 'mirror']
]) {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    minify: true,
    target: ['chrome122'],
    outfile: `${PACK}/dist/${dir}/app.js`
  })
}
cpSync('ui/index.html', `${PACK}/dist/ui/index.html`)
cpSync('ui/mirror/index.html', `${PACK}/dist/mirror/index.html`)

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

// The scrcpy server jar rides next to the built host (dist/host/) — mirror.ts reads it via __dirname.
cpSync(JAR, `${PACK}/dist/host/scrcpy-server.jar`)

cpSync('garret.manifest.json', `${PACK}/garret.manifest.json`)
console.log('built → pack/')
