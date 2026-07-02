import { utilityProcess, type UtilityProcess } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WireMessage } from '@garretapp/sdk'
import { ensureDataDir } from '@main/ext/install'
import { extSecretKeyHex } from '@main/ext/keys'

/**
 * Per-instance host process for a full-tier extension. A THIN frame pipe: correlation lives in the
 * SDK client (renderer), so main just forwards WireMessages both ways + owns the lifecycle
 * (login-shell PATH + data-dir/secret-key env injection; ready-timeout; SIGTERM→onDispose→SIGKILL).
 * Web-tier extensions have no host — they only use the platform broker.
 */

const execFileP = promisify(execFile)
let cachedPath: string | null = null
async function loginPath(): Promise<string> {
  if (cachedPath !== null) return cachedPath
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const { stdout } = await execFileP(shell, ['-ilc', 'echo $PATH'], { timeout: 4000 })
    cachedPath = stdout.trim() || process.env.PATH || ''
  } catch {
    cachedPath = process.env.PATH || ''
  }
  return cachedPath
}

/** Garret's own env with all GARRET_* stripped, so only the GARRET_EXT_* we inject reaches the host. */
function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GARRET_')) env[k] = v
  return env
}

type FrameCb = (msg: WireMessage) => void

export class ExtensionHost {
  private readonly child: UtilityProcess
  private frameCb: FrameCb | null = null
  private readonly ready: Promise<void>
  private markReady: () => void = () => undefined
  private failReady: (e: Error) => void = () => undefined
  private killed = false

  private constructor(
    readonly extId: string,
    entryFile: string,
    env: NodeJS.ProcessEnv
  ) {
    this.child = utilityProcess.fork(entryFile, [], {
      serviceName: `garret-ext:${extId}`,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.ready = new Promise((resolve, reject) => {
      this.markReady = resolve
      this.failReady = reject
    })
    const readyTimer = setTimeout(
      () => this.failReady(new Error(`extension "${extId}" never became ready (crashed at startup?)`)),
      10_000
    )
    void this.ready.catch(() => undefined).finally(() => clearTimeout(readyTimer))

    const log = (buf: Buffer): void => {
      process.stderr.write(`[ext:${extId}] ${buf}`)
    }
    this.child.stdout?.on('data', log)
    this.child.stderr?.on('data', log)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.child.on('message', (msg: any) => {
      if (!msg || typeof msg !== 'object') return
      if (msg.t === 'ready') return this.markReady()
      this.frameCb?.(msg as WireMessage) // res/err/chunk/stream_end/stream_err/event
    })
    this.child.on('exit', (code) => {
      this.killed = true
      this.failReady(new Error(`extension "${extId}" exited (code ${code})`))
    })
  }

  static async launch(extId: string, entryFile: string): Promise<ExtensionHost> {
    const env = baseEnv()
    env.PATH = await loginPath()
    env.GARRET_EXT_ID = extId
    env.GARRET_EXT_DATA_DIR = await ensureDataDir(extId)
    const key = extSecretKeyHex(extId)
    if (key) env.GARRET_EXT_SECRET_KEY = key
    return new ExtensionHost(extId, entryFile, env)
  }

  onFrame(cb: FrameCb): void {
    this.frameCb = cb
  }

  /** Forward a UI→host frame (req / stream_start / cancel). Waits for readiness first. */
  async send(msg: WireMessage): Promise<void> {
    try {
      await this.ready
    } catch {
      return // host died before ready; the SDK client's timeout surfaces it
    }
    if (!this.killed) this.child.postMessage(msg)
  }

  /** Graceful teardown: ask the host to run onDispose + exit, then hard-kill if it lingers. */
  async dispose(): Promise<void> {
    if (this.killed) return
    const exited = new Promise<boolean>((resolve) => {
      this.child.once('exit', () => resolve(true))
      setTimeout(() => resolve(false), 3000)
    })
    try {
      this.child.postMessage({ t: 'dispose' })
    } catch {
      /* already gone */
    }
    if (!(await exited)) this.child.kill()
    this.killed = true
    this.frameCb = null
  }
}

// registry keyed by the UI webview's webContents id (one host per placed instance)
const hosts = new Map<number, ExtensionHost>()

export async function launchHost(wcId: number, extId: string, entryFile: string): Promise<ExtensionHost> {
  await killHost(wcId)
  const host = await ExtensionHost.launch(extId, entryFile)
  hosts.set(wcId, host)
  return host
}
export function getHost(wcId: number): ExtensionHost | undefined {
  return hosts.get(wcId)
}
export async function killHost(wcId: number): Promise<void> {
  const host = hosts.get(wcId)
  if (!host) return
  hosts.delete(wcId)
  await host.dispose()
}
