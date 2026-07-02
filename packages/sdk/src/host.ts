import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, accessSync, constants } from 'node:fs'
import { join, delimiter } from 'node:path'
import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { GarretError } from './errors'
import type { WireMessage } from './protocol'
import type { EventMap, Stream } from './types'

/**
 * Host runtime — runs in Garret's isolated `utilityProcess` with raw Node. `defineHost` hides the
 * wire envelope (see protocol.ts) and gives every method a `ctx` toolkit. The transport is the
 * utilityProcess parent port; storage/secrets use the per-extension data dir + key Garret injects
 * via env (GARRET_EXT_DATA_DIR / GARRET_EXT_SECRET_KEY). See docs/garret.html §Host API.
 */

// ── transport (utilityProcess parent port; loosely typed to avoid an electron dep) ──────────────
interface PortEvent {
  data: WireMessage
}
interface ParentPort {
  postMessage(msg: WireMessage): void
  on(event: 'message', cb: (e: PortEvent) => void): void
}
const port: ParentPort | undefined = (globalThis as { process?: { parentPort?: ParentPort } }).process
  ?.parentPort

function send(msg: WireMessage): void {
  port?.postMessage(msg)
}

// ── ctx toolkit ────────────────────────────────────────────────────────────────────────────────
export interface StreamOut<Chunk, Result> {
  push(chunk: Chunk): void
  end(result: Result): void
  error(err: unknown): void
}
export type StreamFn<Chunk, Result> = (
  out: StreamOut<Chunk, Result>,
  signal: AbortSignal
) => void | Promise<void>

/** A ChildProcess with a convenience `.text()` (buffers stdout to a string). */
export interface SpawnResult extends ChildProcess {
  text(): Promise<string>
}

export interface Storage {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
  clear(): Promise<void>
}
export interface Secrets {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export interface HostContext<Events extends EventMap = EventMap> {
  emit<K extends keyof Events & string>(channel: K, payload: Events[K]): void
  stream<Chunk, Result = void>(fn: StreamFn<Chunk, Result>): Stream<Chunk, Result>
  spawn(argv: string[], opts?: SpawnOptions): SpawnResult
  spawnShell(command: string, opts?: SpawnOptions): SpawnResult
  resolveBinary(name: string, opts?: { hint?: string }): Promise<string>
  storage: Storage
  secrets: Secrets
  fetch: typeof fetch
  onDispose(cb: () => void | Promise<void>): void
  log(...args: unknown[]): void
}

// Runtime brand so the dispatcher can recognise a streaming return value.
const STREAM_RUNTIME = Symbol('garret.stream')
interface StreamMarker {
  [STREAM_RUNTIME]: StreamFn<unknown, unknown>
}
function isStream(v: unknown): v is StreamMarker {
  return typeof v === 'object' && v !== null && STREAM_RUNTIME in v
}

type Methods = Record<string, (args?: unknown) => unknown>

/**
 * Define your host. `factory(ctx)` returns the methods your UI calls (use function declarations so
 * a method can call a sibling — see docs P9). May be async; `ready` is sent only after it resolves.
 */
export function defineHost<Api extends Methods, Events extends EventMap = EventMap>(
  factory: (ctx: HostContext<Events>) => Api | Promise<Api>
): void {
  const children = new Set<ChildProcess>()
  const disposers: Array<() => void | Promise<void>> = []
  const streams = new Map<string, AbortController>()
  let disposed = false

  const scrubbedEnv = (base: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {}
    for (const [k, v] of Object.entries(base)) if (!k.startsWith('GARRET_')) env[k] = v
    return env
  }
  const track = (child: ChildProcess): SpawnResult => {
    children.add(child)
    child.on('exit', () => children.delete(child))
    const r = child as SpawnResult
    r.text = () =>
      new Promise<string>((resolve, reject) => {
        let out = ''
        child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
        child.on('error', reject)
        child.on('close', () => resolve(out))
      })
    return r
  }

  const ctx: HostContext<Events> = {
    emit: (channel, payload) => send({ t: 'event', channel, payload }),
    stream: <Chunk, Result = void>(fn: StreamFn<Chunk, Result>) =>
      ({ [STREAM_RUNTIME]: fn as StreamFn<unknown, unknown> }) as unknown as Stream<Chunk, Result>,
    // Scrub GARRET_* from the FINAL merged env, always — a caller-supplied opts.env must never
    // reopen the leak (the vault key would otherwise reach adb/scrcpy/shells the author didn't write).
    spawn: (argv, opts) =>
      track(
        nodeSpawn(argv[0], argv.slice(1), {
          ...opts,
          shell: false,
          env: scrubbedEnv({ ...process.env, ...(opts?.env ?? {}) })
        })
      ),
    spawnShell: (command, opts) =>
      track(nodeSpawn(command, { ...opts, shell: true, env: scrubbedEnv({ ...process.env, ...(opts?.env ?? {}) }) })),
    resolveBinary,
    storage: makeStorage(),
    secrets: makeSecrets(),
    fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
    onDispose: (cb) => disposers.push(cb),
    log: (...args) => console.error('[host]', ...args)
  }

  async function runDispose(): Promise<void> {
    if (disposed) return
    disposed = true
    for (const ac of streams.values()) ac.abort()
    for (const cb of disposers) {
      try {
        await cb()
      } catch {
        /* best-effort */
      }
    }
    for (const c of children) c.kill()
    process.exit(0)
  }

  function driveStream(id: string, fn: StreamFn<unknown, unknown>): void {
    const ac = new AbortController()
    streams.set(id, ac)
    const done = (final: () => void): void => {
      if (!streams.has(id)) return
      streams.delete(id)
      final()
    }
    const out: StreamOut<unknown, unknown> = {
      push: (chunk) => streams.has(id) && send({ t: 'chunk', id, data: chunk }),
      end: (result) => done(() => send({ t: 'stream_end', id, result })),
      error: (err) => done(() => send({ t: 'stream_err', id, ...wireError(err) }))
    }
    // The stream stays open until out.end/out.error; a rejecting fn errors it (a resolving fn does
    // NOT auto-end — spawn-style streams return synchronously and end later in a 'close' handler).
    Promise.resolve()
      .then(() => fn(out, ac.signal))
      .catch((err) => out.error(err))
  }

  async function handleCall(id: string, method: string, args: unknown, streaming: boolean): Promise<void> {
    const methods = ready as Api | undefined
    const fn = methods?.[method]
    if (typeof fn !== 'function') {
      const e = { code: 'BAD_ARGS', message: `unknown method: ${method}` }
      return send(streaming ? { t: 'stream_err', id, ...e } : { t: 'err', id, ...e })
    }
    try {
      const result = await fn(args)
      const streamRet = isStream(result)
      // Reconcile the client's static stream-list against the runtime return, so a mismatch is a
      // loud error, not a silent hang (S2).
      if (streaming && !streamRet) {
        return send({ t: 'stream_err', id, code: 'BAD_ARGS', message: `method "${method}" did not return a stream` })
      }
      if (!streaming && streamRet) {
        return send({ t: 'err', id, code: 'BAD_ARGS', message: `method "${method}" is streaming — call it as a stream` })
      }
      if (streamRet) driveStream(id, result[STREAM_RUNTIME])
      else send({ t: 'res', id, result })
    } catch (err) {
      const e = wireError(err)
      send(streaming ? { t: 'stream_err', id, code: e.code, message: e.message } : { t: 'err', id, ...e })
    }
  }

  let ready: Api | undefined
  port?.on('message', (e) => {
    const msg = e.data
    if (!msg || typeof msg !== 'object') return
    switch (msg.t) {
      case 'req':
      case 'stream_start':
        void handleCall(msg.id, msg.method, msg.args, msg.t === 'stream_start')
        break
      case 'cancel':
        streams.get(msg.id)?.abort()
        streams.delete(msg.id)
        break
      case 'dispose':
        void runDispose()
        break
    }
  })
  process.on('SIGTERM', () => void runDispose())

  // Build methods, then announce ready. A throw here hits stderr (piped) + main's ready-timeout.
  Promise.resolve()
    .then(() => factory(ctx))
    .then((methods) => {
      ready = methods
      send({ t: 'ready' })
    })
    .catch((err) => {
      // The host can't run without its methods. Log (piped to Garret's dev console) and exit now,
      // so main's exit handler surfaces the failure immediately instead of after the ready-timeout.
      console.error('[host] factory failed during startup:', err)
      process.exit(1)
    })
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
function wireError(err: unknown): { code: string; message: string; hint?: string } {
  if (err instanceof GarretError) return { code: err.code, message: err.message, hint: err.hint }
  if (err instanceof Error && err.name === 'AbortError') return { code: 'CANCELLED', message: err.message }
  return { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) }
}

const PROBE: Record<string, string[]> = {
  darwin: ['/opt/homebrew/bin', '/usr/local/bin', '/opt/homebrew/sbin'],
  linux: ['/usr/local/bin', '/usr/bin', '/snap/bin', `${process.env.HOME}/.local/bin`],
  win32: [`${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Packages`, 'C:\\ProgramData\\chocolatey\\bin']
}
async function resolveBinary(name: string, opts?: { hint?: string }): Promise<string> {
  const platform = process.platform
  const exe = platform === 'win32' ? `${name}.exe` : name
  const dirs = [...(process.env.PATH?.split(delimiter) ?? []), ...(PROBE[platform] ?? [])]
  for (const dir of dirs) {
    if (!dir || dir.includes('undefined')) continue // guard PROBE entries built from unset env vars
    const full = join(dir, exe)
    try {
      accessSync(full, constants.X_OK)
      return full
    } catch {
      /* keep probing */
    }
  }
  throw new GarretError('BINARY_NOT_FOUND', `${name} not found on PATH`, {
    hint: opts?.hint ?? `install ${name} via your package manager`
  })
}

// ── data-dir-backed storage + secrets (Garret injects the dir + key via env) ────────────────────
function dataDir(): string {
  const dir = process.env.GARRET_EXT_DATA_DIR
  if (!dir) throw new GarretError('UNAVAILABLE', 'storage/secrets unavailable (no data dir)')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
function writeJsonAtomic(file: string, obj: Record<string, unknown>): void {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(obj))
  renameSync(tmp, file)
}
/** Serialize writes so a read-merge-write can't interleave (key-level merge, not clobber). */
function makeChain(): <T>(fn: () => T) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => T) => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => undefined)
    return next as Promise<T>
  }
}

function makeStorage(): Storage {
  const queue = makeChain()
  const file = (): string => join(dataDir(), 'storage.json')
  return {
    get: async <T = unknown>(key: string) => readJson(file())[key] as T | undefined,
    set: (key, value) =>
      queue(() => {
        const f = file()
        const all = readJson(f)
        all[key] = value
        writeJsonAtomic(f, all)
      }),
    delete: (key) =>
      queue(() => {
        const f = file()
        const all = readJson(f)
        delete all[key]
        writeJsonAtomic(f, all)
      }),
    keys: async () => Object.keys(readJson(file())),
    clear: () => queue(() => writeJsonAtomic(file(), {}))
  }
}

function secretKey(): Buffer {
  const hex = process.env.GARRET_EXT_SECRET_KEY
  if (!hex) throw new GarretError('UNAVAILABLE', 'secrets unavailable on this platform')
  return Buffer.from(hex, 'hex')
}
interface SecretBox {
  v: 1
  iv: string
  tag: string
  ct: string
}
function makeSecrets(): Secrets {
  const queue = makeChain()
  const file = (): string => join(dataDir(), 'secrets.json')
  return {
    get: async (key: string) => {
      const box = readJson(file())[key] as SecretBox | undefined
      if (!box) return undefined
      const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(box.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(box.tag, 'base64'))
      try {
        return decipher.update(Buffer.from(box.ct, 'base64')).toString('utf8') + decipher.final('utf8')
      } catch {
        throw new GarretError('INTERNAL', `secret "${key}" failed to decrypt`)
      }
    },
    set: (key, value) =>
      queue(() => {
        const iv = randomBytes(12) // GCM: fresh 96-bit nonce per set (never reuse)
        const cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
        const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
        const box: SecretBox = { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') }
        const f = file()
        const all = readJson(f)
        all[key] = box
        writeJsonAtomic(f, all)
      }),
    delete: (key) =>
      queue(() => {
        const f = file()
        const all = readJson(f)
        delete all[key]
        writeJsonAtomic(f, all)
      })
  }
}

// re-exports so `@garret/sdk/host` is a complete surface
export { GarretError } from './errors'
export type { Stream } from './types'
// timingSafeEqual kept imported for future MAC checks; referenced to avoid unused-import in strict builds
void timingSafeEqual
