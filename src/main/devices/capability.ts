import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Device-control capability (Android via adb; iOS list-only via devicectl) for the native
 * extension tier. Pure node built-ins — electron-free, so it unit-tests standalone.
 * Binary discovery is deliberate: a GUI-launched .app gets a minimal PATH, so adb/scrcpy on
 * Homebrew or the Android SDK dir aren't visible to a plain spawn (see native-extensions §5).
 */

const execFileP = promisify(execFile)

// ---- binary discovery ------------------------------------------------------

let cachedPath: string | null = null
/** The user's real login-shell PATH (a GUI app's process.env.PATH is minimal). Cached. */
async function userPath(): Promise<string> {
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

/** Extra dirs adb/scrcpy commonly live in that aren't necessarily on PATH. */
function commonDirs(): string[] {
  const home = homedir()
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    join(home, '.local/bin'),
    join(home, 'Library/Android/sdk/platform-tools'),
    join(home, 'Android/Sdk/platform-tools')
  ]
  for (const env of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (env) dirs.push(join(env, 'platform-tools'))
  }
  return dirs
}

const binCache = new Map<string, string | null>()
/** Absolute path to a binary, searching the real PATH + common install dirs; null if missing. */
export async function findBinary(name: string): Promise<string | null> {
  if (binCache.has(name)) return binCache.get(name) ?? null
  const seen = new Set<string>()
  const dirs = [...(await userPath()).split(':'), ...commonDirs()].filter(Boolean)
  let found: string | null = null
  for (const dir of dirs) {
    if (seen.has(dir)) continue
    seen.add(dir)
    const p = join(dir, name)
    if (existsSync(p)) {
      found = p
      break
    }
  }
  binCache.set(name, found)
  return found
}

// ---- devices ---------------------------------------------------------------

export interface Device {
  serial: string
  platform: 'android' | 'ios'
  state: string // 'device' | 'unauthorized' | 'offline' | ...
  model?: string
  osVersion?: string
  battery?: number
}

/** `adb -s <serial> shell <args...>` → trimmed stdout, or '' on failure. */
async function adbShell(adb: string, serial: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP(adb, ['-s', serial, 'shell', ...args], { timeout: 5000 })
    return stdout.trim()
  } catch {
    return ''
  }
}

/** Connected Android devices with best-effort info. [] if adb is missing or none connected. */
export async function listAndroid(): Promise<Device[]> {
  const adb = await findBinary('adb')
  if (!adb) return []
  let out = ''
  try {
    out = (await execFileP(adb, ['devices', '-l'], { timeout: 5000 })).stdout
  } catch {
    return []
  }
  const devices: Device[] = []
  for (const line of out.split('\n').slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+/)
    const serial = parts[0]
    const state = parts[1] ?? 'unknown'
    const modelTok = parts.find((p) => p.startsWith('model:'))
    const dev: Device = {
      serial,
      platform: 'android',
      state,
      model: modelTok ? modelTok.slice('model:'.length).replace(/_/g, ' ') : undefined
    }
    if (state === 'device') {
      dev.osVersion = (await adbShell(adb, serial, ['getprop', 'ro.build.version.release'])) || undefined
      if (!dev.model) dev.model = (await adbShell(adb, serial, ['getprop', 'ro.product.model'])) || undefined
      const batt = await adbShell(adb, serial, ['dumpsys', 'battery'])
      const m = batt.match(/level:\s*(\d+)/)
      if (m) dev.battery = Number(m[1])
    }
    devices.push(dev)
  }
  return devices
}

/** Connected iOS devices (list/info only — Apple forbids control). [] if devicectl unavailable. */
export async function listIos(): Promise<Device[]> {
  const xcrun = await findBinary('xcrun')
  if (!xcrun) return []
  try {
    // devicectl needs full Xcode; JSON output keeps parsing robust across versions.
    const { stdout } = await execFileP(
      xcrun,
      ['devicectl', 'list', 'devices', '--json-output', '/dev/stdout', '--quiet'],
      { timeout: 8000 }
    )
    const json = JSON.parse(stdout)
    const items: unknown[] = json?.result?.devices ?? []
    return items
      .map((d): Device | null => {
        const dev = d as Record<string, unknown>
        const props = (dev.deviceProperties ?? {}) as Record<string, unknown>
        const hw = (dev.hardwareProperties ?? {}) as Record<string, unknown>
        const serial = String(dev.identifier ?? props.name ?? '')
        if (!serial) return null
        return {
          serial,
          platform: 'ios',
          state: String((dev.connectionProperties as Record<string, unknown>)?.tunnelState ?? 'connected'),
          model: hw.marketingName ? String(hw.marketingName) : props.name ? String(props.name) : undefined,
          osVersion: props.osVersionNumber ? String(props.osVersionNumber) : undefined
        }
      })
      .filter((d): d is Device => d !== null)
  } catch {
    return []
  }
}

/** All connected devices (Android + iOS). */
export async function listDevices(): Promise<Device[]> {
  const [android, ios] = await Promise.all([listAndroid(), listIos()])
  return [...android, ...ios]
}

// ---- scrcpy mirror (Android; spawn + kill only — see §8) -------------------

const mirrors = new Map<string, ChildProcess>()

export async function launchMirror(serial: string): Promise<{ ok: boolean; error?: string }> {
  const scrcpy = await findBinary('scrcpy')
  if (!scrcpy) return { ok: false, error: 'scrcpy is not installed — run: brew install scrcpy' }
  if (mirrors.has(serial)) return { ok: true } // already mirroring
  const adb = await findBinary('adb')
  // scrcpy shells out to adb, so hand it the resolved PATH + ADB location.
  const proc = spawn(scrcpy, ['-s', serial], {
    env: { ...process.env, PATH: await userPath(), ...(adb ? { ADB: adb } : {}) },
    stdio: 'ignore',
    detached: false
  })
  mirrors.set(serial, proc)
  proc.on('exit', () => mirrors.delete(serial))
  proc.on('error', () => mirrors.delete(serial))
  return { ok: true }
}

export function stopMirror(serial: string): void {
  mirrors.get(serial)?.kill()
  mirrors.delete(serial)
}

export function isMirroring(serial: string): boolean {
  return mirrors.has(serial)
}
