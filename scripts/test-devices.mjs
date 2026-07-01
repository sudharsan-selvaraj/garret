// Headless test for the device-control capability (native-extensions MVP-a/b).
// Run: node scripts/test-devices.mjs  (bundles src/main/devices/capability.ts via esbuild)
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const bundle = new URL('../._devices_test_bundle.mjs', import.meta.url).pathname
execFileSync('npx', ['esbuild', 'src/main/devices/capability.ts', '--bundle', '--platform=node',
  '--format=esm', '--outfile=' + bundle], { stdio: 'inherit' })
const cap = await import(bundle)

try {
  const adb = await cap.findBinary('adb')
  const scrcpy = await cap.findBinary('scrcpy')
  console.log(`findBinary('adb')    → ${adb ?? 'NOT FOUND'}`)
  console.log(`findBinary('scrcpy') → ${scrcpy ?? 'NOT FOUND (expected if not installed)'}`)

  console.log('\nlistDevices()…')
  const devices = await cap.listDevices()
  if (devices.length === 0) {
    console.log('  (no devices connected — expected; proves adb/devicectl ran without throwing)')
  } else {
    for (const d of devices) {
      console.log(`  • ${d.platform} ${d.serial} [${d.state}] ${d.model ?? ''} ${d.osVersion ?? ''} ${d.battery != null ? d.battery + '%' : ''}`.trimEnd())
    }
  }

  // launchMirror on a fake serial → should gracefully report scrcpy missing (not crash).
  const res = await cap.launchMirror('nonexistent-serial')
  console.log(`\nlaunchMirror(fake) → ${res.ok ? 'ok' : 'error: ' + res.error}`)

  console.log('\n✓ capability module runs; discovery + adb/devicectl invocation are graceful.')
} finally {
  rmSync(bundle, { force: true })
}
