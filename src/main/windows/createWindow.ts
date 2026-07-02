import { join } from 'path'
import { app, BrowserWindow, screen } from 'electron'
import {
  pinToDesktop,
  raiseToHud,
  makePanel,
  disableFrameConstraint,
  startCursorMonitor,
  stopCursorMonitor
} from '@main/windows/macWindow'
import { Channels } from '@shared/ipc/channels'
import type { WindowMode } from '@shared/types/window'

export type { WindowMode }

/**
 * Level offset above the desktop-ICON level (see native/mac_window.mm).
 * +1 places the layer just above Finder's icon window so clicks reach our widgets,
 * while still sitting far below the normal window level (behind every app).
 * Trade-off: widgets render above desktop icons (covering them).
 */
const DESKTOP_LEVEL_OFFSET = 1

/**
 * The board spans ALL displays (docs § Pre-SDK #8): one window sized to the union of every
 * display's bounds, giving one global grid. Display gaps become dead zones (harmless — click-through).
 */
function unionBounds(): { x: number; y: number; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const d of screen.getAllDisplays()) {
    const b = d.bounds
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * When the HUD is summoned we raise the window above everything. macOS fires
 * `show` events while it composites the window onto a full-screen Space; without
 * this guard the `show` handler would re-pin it to the desktop level on every one
 * of those events — slamming it back behind your apps and causing the flap.
 */
let hudMode = false
export function setHudMode(active: boolean): void {
  hudMode = active
}

/**
 * Creates the Garret window. Both modes share the same renderer/canvas — the only
 * difference is window level + chrome, so the proven widget board drops straight
 * onto the desktop layer.
 */
export function createWindow(mode: WindowMode): BrowserWindow {
  const isDesktop = mode === 'desktop'
  // Full display bounds (NOT workArea) so the desktop layer — and especially the
  // HUD's dim backdrop — covers the ENTIRE screen, including behind the menu bar
  // and Dock. workArea subtracts whatever the Dock reserves, which would otherwise
  // leave an uncovered strip (e.g. a left/bottom Dock) showing through as an
  // undimmed gap when the HUD is summoned.
  let bounds = unionBounds()

  const win = new BrowserWindow({
    ...(isDesktop
      ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
      : { width: 1280, height: 860 }),
    show: false,
    title: 'Garret',
    transparent: isDesktop,
    frame: !isDesktop,
    hasShadow: !isDesktop,
    resizable: !isDesktop,
    movable: !isDesktop,
    focusable: true, // keep true in both modes so widgets accept clicks + keyboard
    skipTaskbar: isDesktop,
    backgroundColor: isDesktop ? '#00000000' : '#0e1014',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Let Chromium throttle timers/rAF when the window is actually occluded (covered by apps).
      // This is the OS-driven half of the power story; the poll scheduler's HUD-gated interval
      // stretch (setBoardActive) is the main-process half Chromium can't see. See architecture.md §6.
      backgroundThrottling: true,
      // Required for embedding third-party sites that block iframes (Calendar/Jira).
      webviewTag: true,
      // Surface the window mode + role to the renderer (read in preload from argv).
      additionalArguments: [`--garret-mode=${mode}`, '--garret-role=board']
    }
  })

  if (isDesktop) {
    // Make it a non-activating panel up front so HUD mode can float it over other
    // apps' full-screen Spaces without activation/Space-switch (the flicker fix).
    makePanel(win.getNativeWindowHandle())
    // Stop macOS clamping the frame into the workArea so the layer truly fills the
    // screen (otherwise the HUD's dim leaves an undimmed strip under the Dock).
    disableFrameConstraint(win.getNativeWindowHandle())
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // Native pin: set the NSWindow level below normal windows while staying interactive.
    const pin = (): void => {
      const ok = pinToDesktop(win.getNativeWindowHandle(), DESKTOP_LEVEL_OFFSET)
      if (!ok) console.warn('[window] desktop pin failed; window is at normal level.')
    }
    // macOS constrains a normal-level window so its frame stays clear of the menu
    // bar/Dock, shifting our full-screen window's origin to the workArea (leaving an
    // undimmed strip in HUD). Re-assert the true full-screen frame AFTER pinning to
    // the desktop level, where AppKit no longer applies that constraint.
    const fillScreen = (): void => {
      win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
    }
    pin()
    fillScreen()
    // Re-apply after show — Electron can reset the level when the window is ordered
    // in — but NOT while the HUD is up, or we'd slam it back behind your apps.
    win.on('show', () => {
      if (!hudMode) {
        pin()
        fillScreen()
      }
    })
    // Re-fit the spanning board when displays change (plug/unplug, arrangement, scale). Bail when
    // the union is unchanged — setBounds can itself fire display-metrics-changed, so this prevents a
    // re-entrant loop + repeated board saves (review S5).
    const refit = (): void => {
      const nb = unionBounds()
      if (nb.x === bounds.x && nb.y === bounds.y && nb.width === bounds.width && nb.height === bounds.height) {
        return
      }
      bounds = nb
      pin()
      fillScreen()
      win.webContents.send(Channels.displaysChanged, bounds)
    }
    screen.on('display-added', refit)
    screen.on('display-removed', refit)
    screen.on('display-metrics-changed', refit)
    win.on('closed', () => {
      screen.removeListener('display-added', refit)
      screen.removeListener('display-removed', refit)
      screen.removeListener('display-metrics-changed', refit)
    })
    trackCursor(win)
  }

  win.once('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Open the board window's DevTools in dev — detached, so it's a separate window even when the
  // board is pinned to the desktop layer.
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  return win
}

/** Re-pin a window to the desktop level (used when leaving HUD mode). */
export function pinToDesktopLevel(win: BrowserWindow): void {
  pinToDesktop(win.getNativeWindowHandle(), DESKTOP_LEVEL_OFFSET)
}

/** Float a window above everything (incl. full-screen Spaces) for HUD mode. */
export function raiseWindowToHud(win: BrowserWindow): void {
  raiseToHud(win.getNativeWindowHandle())
}

/**
 * Fallback poll interval, used ONLY when the native event monitor is unavailable.
 * The preferred path (trackCursor) is event-driven and has no fixed-rate timer.
 */
const CURSOR_POLL_MS = 60

/**
 * Push the current cursor position (window-relative) to the renderer, which uses
 * it to toggle click-through as the cursor crosses widget boundaries. We read the
 * position via Electron's screen API (correct across displays/Retina) rather than
 * trusting a desktop-level non-key window to receive forwarded DOM mouse events,
 * which macOS delivers unreliably. Skips the IPC when the cursor hasn't actually
 * moved (dedupe), so there's nothing downstream for an idle cursor.
 */
function makeCursorEmitter(win: BrowserWindow): () => void {
  let lastX = Number.NaN
  let lastY = Number.NaN
  return () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    const pt = screen.getCursorScreenPoint()
    if (pt.x === lastX && pt.y === lastY) return // no real movement — nothing to do
    lastX = pt.x
    lastY = pt.y
    const b = win.getBounds()
    win.webContents.send(Channels.cursorPos, { x: pt.x - b.x, y: pt.y - b.y })
  }
}

/**
 * Drive click-through from cursor movement. Preferred path: a native NSEvent
 * monitor (see macWindow.ts / mac_window.mm) that fires only when the mouse moves —
 * zero cost while idle, no fixed-rate timer. If native is unavailable we fall back
 * to a coarse poll so the layer still works (degraded energy, same behavior).
 */
function trackCursor(win: BrowserWindow): void {
  const emit = makeCursorEmitter(win)

  if (startCursorMonitor(emit)) {
    win.on('closed', () => stopCursorMonitor())
    return
  }

  const timer = setInterval(() => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      clearInterval(timer)
      return
    }
    emit()
  }, CURSOR_POLL_MS)
  win.on('closed', () => clearInterval(timer))
}
