import { utilityProcess, type UtilityProcess } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Native-extension execution lane (raw Node).
 *
 * An extension's system logic runs in a `utilityProcess` — a full Node process, isolated from
 * the app's main/renderer (crash-safe; where a Seatbelt profile will later attach). Garret forks
 * the extension's OWN Node entry (it brings all its logic — adb/scrcpy/etc.) with the resolved
 * login-shell PATH injected, and speaks a small bridge over the parent port. There is NO
 * capability gate here — native extensions are trusted, full-access by design.
 *
 * Bridge envelope (parent ⇄ ext):
 *   parent → ext:  { t:'req', id, method, args }
 *   ext → parent:  { t:'ready' } | { t:'res', id, ok, value?, error? } | { t:'event', channel, payload }
 */

const execFileP = promisify(execFile)

// ---- resolved login-shell PATH (a GUI .app's PATH is minimal; §5) ----------
let cachedPath: string | null = null
export async function resolveUserPath(): Promise<string> {
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

type EventCb = (channel: string, payload: unknown) => void

/** One running native extension: a forked Node process + a request/response + event bridge. */
export class ExtensionHost {
  private readonly child: UtilityProcess
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private readonly listeners = new Set<EventCb>()
  private seq = 0
  private ready: Promise<void>
  private killed = false

  constructor(
    readonly id: string,
    entryFile: string,
    userPath: string
  ) {
    this.child = utilityProcess.fork(entryFile, [], {
      serviceName: `garret-ext:${id}`,
      env: { ...process.env, PATH: userPath }
    })
    let onReady: () => void = () => undefined
    this.ready = new Promise((r) => (onReady = r))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.child.on('message', (msg: any) => {
      if (!msg || typeof msg !== 'object') return
      if (msg.t === 'ready') return onReady()
      if (msg.t === 'res') {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        msg.ok ? p.resolve(msg.value) : p.reject(new Error(String(msg.error ?? 'extension error')))
        return
      }
      if (msg.t === 'event') this.listeners.forEach((cb) => cb(String(msg.channel), msg.payload))
    })
    this.child.on('exit', () => this.dispose(new Error(`extension "${id}" exited`)))
  }

  /** Call a method the extension exposes; resolves with its result. */
  async request<T = unknown>(method: string, args: unknown = null, timeoutMs = 15_000): Promise<T> {
    await this.ready
    if (this.killed) throw new Error(`extension "${this.id}" is not running`)
    const id = String(++this.seq)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`extension "${this.id}" method "${method}" timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      this.child.postMessage({ t: 'req', id, method, args })
    })
  }

  /** Subscribe to extension-emitted events (e.g. device hotplug). Returns an unsubscribe fn. */
  onEvent(cb: EventCb): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private dispose(err: Error): void {
    if (this.killed) return
    this.killed = true
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.listeners.clear()
  }

  kill(): void {
    if (this.killed) return
    this.child.kill()
    this.dispose(new Error(`extension "${this.id}" killed`))
  }
}

// ---- registry --------------------------------------------------------------
const hosts = new Map<string, ExtensionHost>()

export async function launchExtension(id: string, entryFile: string): Promise<ExtensionHost> {
  killExtension(id)
  const host = new ExtensionHost(id, entryFile, await resolveUserPath())
  hosts.set(id, host)
  return host
}
export function getExtension(id: string): ExtensionHost | undefined {
  return hosts.get(id)
}
export function killExtension(id: string): void {
  hosts.get(id)?.kill()
  hosts.delete(id)
}
