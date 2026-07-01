import { utilityProcess } from 'electron'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Native-extension execution lane (raw Node) — go/no-go proof.
 *
 * A native extension's system logic runs in a `utilityProcess` (a full Node process, isolated
 * from the app renderer/main — crash-safe, and the place a Seatbelt profile will later be
 * applied). This proof forks a tiny bootstrap that exercises RAW NODE (`require`,
 * `child_process`) and reports back over the parent port, to confirm the model works in this
 * Electron before the real lane + UI bridge are built. The real lane will fork the *widget's*
 * Node entry instead of this inline bootstrap.
 */
const PROOF_BOOTSTRAP = `
process.parentPort.on('message', () => {
  const os = require('os')
  let whoami = ''
  try { whoami = require('child_process').execSync('whoami').toString().trim() } catch (e) {}
  process.parentPort.postMessage({
    ok: true,
    node: process.version,
    hostname: os.hostname(),
    whoami,
    pid: process.pid,
    requireWorks: typeof require === 'function',
    childProcessWorks: typeof require('child_process').execSync === 'function'
  })
})
`

/** Fork a raw-Node utilityProcess, run the proof bootstrap, and resolve its report. */
export async function proveRawNodeHost(): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(join(tmpdir(), 'garret-ext-'))
  const entry = join(dir, 'host.cjs')
  await writeFile(entry, PROOF_BOOTSTRAP)

  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(entry, [], { serviceName: 'garret-native-ext' })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('extension host: no response within 5s'))
    }, 5000)
    child.on('spawn', () => child.postMessage({ kind: 'run' }))
    child.on('message', (msg: Record<string, unknown>) => {
      clearTimeout(timer)
      child.kill()
      resolve(msg)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`extension host exited (${code}) before responding`))
    })
  })
}
