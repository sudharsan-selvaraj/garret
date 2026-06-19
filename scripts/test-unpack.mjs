// Standalone adversarial test for the .garret slip-safe extractor (no test framework).
// Run: node scripts/test-unpack.mjs   (bundles src/main/sandbox/unpack.ts via esbuild first)
// Uses python3 zipfile to craft hostile archives (yazl/most writers refuse `..`/absolute names).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'garret-unpack-test-'))
// Emit the bundle INSIDE the project so node resolves the externalized `yauzl` (CommonJS,
// can't be inlined into an ESM bundle) from ./node_modules.
const bundle = join(process.cwd(), '._unpack_test_bundle.mjs')
execFileSync(
  'npx',
  ['esbuild', 'src/main/sandbox/unpack.ts', '--bundle', '--platform=node', '--format=esm',
   '--external:yauzl', `--outfile=${bundle}`],
  { stdio: 'inherit' }
)
const { unpackZip } = await import(bundle)

const PY = `
import sys, json, zipfile
out = sys.argv[1]; entries = json.loads(sys.argv[2])
zf = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
for e in entries:
    zi = zipfile.ZipInfo(e['path'])
    if e.get('mode'): zi.external_attr = e['mode'] << 16
    data = e['data'] if 'data' in e else (e.get('fill','x') * e.get('size',1))
    zf.writestr(zi, data.encode() if isinstance(data, str) else data)
zf.close()
`
function makeZip(name, entries) {
  const zipPath = join(TMP, name)
  execFileSync('python3', ['-c', PY, zipPath, JSON.stringify(entries)])
  return zipPath
}

let pass = 0
let fail = 0
async function expectOk(label, zipPath, check) {
  const dest = mkdtempSync(join(TMP, 'out-'))
  try {
    await unpackZip(zipPath, dest)
    if (check) check(dest)
    console.log(`✓ ${label}`)
    pass++
  } catch (e) {
    console.log(`✗ ${label} — unexpectedly threw: ${e.message}`)
    fail++
  }
}
async function expectReject(label, zipPath, expectMatch) {
  const dest = mkdtempSync(join(TMP, 'out-'))
  try {
    await unpackZip(zipPath, dest)
    console.log(`✗ ${label} — should have thrown but did not`)
    fail++
  } catch (e) {
    if (expectMatch && !expectMatch.test(e.message)) {
      console.log(`✗ ${label} — threw wrong error: ${e.message}`)
      fail++
    } else {
      console.log(`✓ ${label} — rejected (${e.message})`)
      pass++
    }
  }
}

try {
  await expectOk('valid archive extracts', makeZip('good.garret', [
    { path: 'manifest.json', data: '{"id":"x","name":"X"}' },
    { path: 'index.html', data: '<!doctype html>' },
    { path: 'bundle.js', data: 'console.log(1)' },
    { path: 'assets/icon.svg', data: '<svg/>' }
  ]), (dest) => {
    for (const f of ['manifest.json', 'index.html', 'bundle.js', 'assets/icon.svg']) {
      if (!existsSync(join(dest, f))) throw new Error(`missing ${f}`)
    }
    if (readFileSync(join(dest, 'bundle.js'), 'utf8') !== 'console.log(1)') throw new Error('bad content')
  })

  await expectReject('rejects ../ traversal',
    makeZip('slip.garret', [{ path: 'manifest.json', data: '{}' }, { path: '../evil.js', data: 'pwn' }]),
    /unsafe path|escapes|invalid relative path/)

  await expectReject('rejects nested a/../../ traversal',
    makeZip('slip2.garret', [{ path: 'a/../../evil.js', data: 'pwn' }]), /unsafe path|escapes|invalid relative path/)

  await expectReject('rejects absolute path',
    makeZip('abs.garret', [{ path: '/etc/passwd', data: 'pwn' }]), /unsafe path|absolute path/)

  await expectReject('rejects symlink entry',
    makeZip('link.garret', [
      { path: 'manifest.json', data: '{}' },
      { path: 'link', data: '/etc/passwd', mode: 0o120777 }
    ]), /symlink/)

  await expectReject('rejects disallowed extension',
    makeZip('badext.garret', [{ path: 'manifest.json', data: '{}' }, { path: 'evil.sh', data: '#!/bin/sh' }]),
    /file type not allowed/)

  await expectReject('rejects too many files',
    makeZip('many.garret', Array.from({ length: 205 }, (_, i) => ({ path: `f${i}.js`, data: 'x' }))),
    /too many files/)

  await expectReject('rejects oversize (>20MB)',
    makeZip('bomb.garret', [{ path: 'big.js', fill: 'a', size: 21 * 1024 * 1024 }]), /exceeds 20MB/)

  await expectReject('rejects backslash path',
    makeZip('bslash.garret', [{ path: 'a\\..\\evil.js', data: 'x' }]), /unsafe path|invalid relative path/)
} finally {
  console.log(`\n${pass} passed, ${fail} failed`)
  rmSync(TMP, { recursive: true, force: true })
  rmSync(bundle, { force: true })
  process.exit(fail ? 1 : 0)
}
