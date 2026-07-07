import { utilityProcess, type UtilityProcess } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WireMessage } from '@garretapp/sdk'
import { ensureWidgetDataDir, ensureSharedDataDir } from '@main/ext/install'
import { extSecretKeyHex } from '@main/ext/keys'

/** What launching a widget's host needs — per-widget data dir + secret key, + opt-in pack-shared. */
export interface WidgetHostDescriptor {
  fullId: string
  packId: string
  widgetId: string
  nodeEntry: string
  hasShared: boolean
}

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
      serviceName: `garret-ext:${extId.replace(/[^a-z0-9.]+/gi, '-')}`, // fullId has a "/"
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

  static async launch(d: WidgetHostDescriptor): Promise<ExtensionHost> {
    const env = baseEnv()
    env.PATH = await loginPath()
    env.GARRET_EXT_ID = d.fullId
    env.GARRET_EXT_DATA_DIR = await ensureWidgetDataDir(d.packId, d.widgetId)
    const key = extSecretKeyHex(d.fullId)
    if (key) env.GARRET_EXT_SECRET_KEY = key
    // Opt-in pack-shared namespace (only when the pack declares `shared`), with its OWN key.
    if (d.hasShared) {
      env.GARRET_PACK_SHARED_DIR = await ensureSharedDataDir(d.packId)
      const sharedKey = extSecretKeyHex(`${d.packId}/_shared`)
      if (sharedKey) env.GARRET_PACK_SHARED_KEY = sharedKey
    }
    return new ExtensionHost(d.fullId, d.nodeEntry, env)
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
    this.killed = true // set first: no frame can be posted to a disposing child
    this.frameCb = null
    let timer: NodeJS.Timeout | undefined
    const exited = new Promise<boolean>((resolve) => {
      this.child.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
      timer = setTimeout(() => resolve(false), 3000)
    })
    try {
      this.child.postMessage({ t: 'dispose' })
    } catch {
      /* already gone */
    }
    if (!(await exited)) this.child.kill()
  }
}

// registry keyed by the UI webview's webContents id (one host per placed instance)
const hosts = new Map<number, ExtensionHost>()

export async function launchHost(wcId: number, d: WidgetHostDescriptor): Promise<ExtensionHost> {
  await killHost(wcId)
  const host = await ExtensionHost.launch(d)
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
