import { join } from 'path'
import { app } from 'electron'

interface MacWindowAddon {
  pinToDesktop(handle: Buffer, levelOffset?: number): boolean
  raiseToHud(handle: Buffer): boolean
  makePanel(handle: Buffer): boolean
}

let addon: MacWindowAddon | null | undefined

function load(): MacWindowAddon | null {
  if (addon !== undefined) return addon
  if (process.platform !== 'darwin') {
    addon = null
    return null
  }
  try {
    const p = join(app.getAppPath(), 'native', 'build', 'Release', 'myview_mac.node')
    // Dynamic require so the bundler leaves the .node load to runtime.
    addon = require(p) as MacWindowAddon
  } catch (err) {
    console.warn('[native] myview_mac unavailable — desktop layer will be non-interactive.', err)
    addon = null
  }
  return addon
}

/**
 * Pin a window to the macOS desktop level (above wallpaper, behind all apps),
 * keeping it interactive. Returns false if the native addon isn't available.
 * `levelOffset` is added to kCGDesktopWindowLevel (see native/mac_window.mm).
 */
export function pinToDesktop(handle: Buffer, levelOffset = 1): boolean {
  const a = load()
  if (!a) return false
  try {
    return a.pinToDesktop(handle, levelOffset)
  } catch (err) {
    console.warn('[native] pinToDesktop failed', err)
    return false
  }
}

/** Float the window above everything (incl. full-screen apps) and activate it. */
export function raiseToHud(handle: Buffer): boolean {
  const a = load()
  if (!a) return false
  try {
    return a.raiseToHud(handle)
  } catch (err) {
    console.warn('[native] raiseToHud failed', err)
    return false
  }
}

/**
 * Convert the window into a non-activating panel — the one window kind macOS lets
 * float over another app's full-screen Space without stealing activation (the HUD
 * fix). Safe to leave on permanently; the desktop layer never needs to activate.
 */
export function makePanel(handle: Buffer): boolean {
  const a = load()
  if (!a) return false
  try {
    return a.makePanel(handle)
  } catch (err) {
    console.warn('[native] makePanel failed', err)
    return false
  }
}
