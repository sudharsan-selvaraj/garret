import { connect } from 'node:net'
import { AdbServerClient } from '@yume-chan/adb'
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp'
import type { HostContext } from '@garretapp/sdk/host'

// We talk to the LOCAL adb server (the daemon `adb` / Android Studio runs on 127.0.0.1:5037).
// ya-webadb's TCP transport connects to it — it does NOT embed adb, so a server must be running.
const HOST = '127.0.0.1'
const PORT = 5037

let client: AdbServerClient | null = null
export function getClient(): AdbServerClient {
  if (!client) client = new AdbServerClient(new AdbServerNodeTcpConnector({ host: HOST, port: PORT }))
  return client
}
function resetClient(): void {
  client = null
}

/** Cheap reachability probe — a raw TCP connect to the adb server port (no adb protocol). */
function serverReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host: HOST, port: PORT })
    const finish = (v: boolean): void => {
      sock.destroy()
      resolve(v)
    }
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
    sock.setTimeout(1000, () => finish(false))
  })
}

/**
 * Ensure a reachable adb server: use it if already running; else start it via a system `adb`
 * (`process` capability); else fail with an install hint the UI shows the user.
 */
export async function ensureServer(ctx: HostContext): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await serverReachable()) return { ok: true }

  let adb: string
  try {
    adb = await ctx.resolveBinary('adb', { hint: 'brew install android-platform-tools' })
  } catch {
    return { ok: false, error: 'adb not found — install Android platform-tools (brew install android-platform-tools), then Retry.' }
  }

  await new Promise<void>((resolve) => {
    const child = ctx.spawn([adb, 'start-server'])
    const t = setTimeout(resolve, 5000) // don't hang if adb never exits; the re-probe is the real check
    const done = (): void => {
      clearTimeout(t)
      resolve()
    }
    child.on('close', done)
    child.on('error', done)
  })
  resetClient() // reconnect against the freshly-started server
  return (await serverReachable())
    ? { ok: true }
    : { ok: false, error: 'adb is installed but its server could not start. Try `adb start-server` in a terminal.' }
}
