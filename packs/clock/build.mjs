import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

// Clock is pure static UI (no bundler needed): assemble pack/ (garret.manifest.json + dist/ui) and
// zip it straight into the app's bundled-packs dir, where installBundledPacks() picks it up.
const PACK = 'pack'
const outDir = resolve(process.cwd(), '..', '..', 'resources', 'packs') // <repo>/resources/packs
const outFile = join(outDir, 'clock.garret')

rmSync(PACK, { recursive: true, force: true })
mkdirSync(`${PACK}/dist`, { recursive: true })
// One dir per widget → dist/<widgetId> (matches each widget's `ui` in the manifest).
for (const w of ['clock', 'world', 'timer', 'stopwatch']) {
  cpSync(`ui/${w}`, `${PACK}/dist/${w}`, { recursive: true })
}
cpSync('garret.manifest.json', `${PACK}/garret.manifest.json`)

mkdirSync(outDir, { recursive: true })
rmSync(outFile, { force: true })
execFileSync('zip', ['-qr', outFile, '.'], { cwd: PACK })
console.log(`built → ${outFile}`)
