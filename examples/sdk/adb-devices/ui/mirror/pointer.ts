import type { PointerInput } from '../../shared/api'

/** The subset of the host client this module drives. */
interface ControlClient {
  pointer(a: PointerInput): Promise<void>
  scroll(a: { serial: string; x: number; y: number; w: number; h: number; dx: number; dy: number }): Promise<void>
}

/** Current displayed frame pixel dims (from the decoder), or null until the first frame. */
export type GetDims = () => { w: number; h: number } | null

// Wheel steps per notch. 3_3_1 divides scroll internally by 16, so this is deliberately large;
// tune against a real device (a value too small produces an imperceptible scroll).
const SCROLL_STEP = 8

/**
 * Forward mouse/touch on the mirror canvas to the device as scrcpy touch/scroll input.
 *
 * - `down`/`up`/`cancel` are sent immediately (ordering matters); `move` is coalesced to one send per
 *   animation frame with a single request in flight — control must never build a backlog (same lesson
 *   as audio). A stale move is never sent after `up`/`cancel` (guarded by `active`).
 * - While a gesture is active, `move`/`up`/`cancel` are listened for on `window` (NOT the canvas):
 *   `setPointerCapture` is unreliable inside an Electron <webview> (a release near the canvas edge is
 *   delivered to another element, so the canvas never sees `pointerup` and the device stays pressed).
 *   `window` always sees the release. Coords are normalized; the host clamps to [0,1].
 */
export function attachPointerControl(
  canvas: HTMLCanvasElement,
  client: ControlClient,
  serial: string,
  getDims: GetDims
): { detach: () => void; cancelGesture: () => void } {
  let active = false
  let detached = false
  let pointerId: number | null = null
  let latest: { x: number; y: number } | null = null // newest un-sent move
  let rafScheduled = false
  let sending = false

  const norm = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const send = (action: PointerInput['action'], p: { x: number; y: number }): void => {
    const dims = getDims()
    if (!dims) return
    void client.pointer({ serial, action, x: p.x, y: p.y, w: dims.w, h: dims.h }).catch(() => {})
  }

  const flush = (): void => {
    rafScheduled = false
    if (detached || !active || sending || !latest) return
    const p = latest
    latest = null
    const dims = getDims()
    if (!dims) return
    sending = true
    void client
      .pointer({ serial, action: 'move', x: p.x, y: p.y, w: dims.w, h: dims.h })
      .catch(() => {})
      .finally(() => {
        sending = false
        if (active && latest && !rafScheduled) {
          rafScheduled = true
          requestAnimationFrame(flush)
        }
      })
  }

  // While a gesture is live, move/up/cancel come from `window` so a release anywhere (incl. off the
  // canvas / outside the window) still ends the gesture.
  const addGestureListeners = (): void => {
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }
  const removeGestureListeners = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }

  const onDown = (e: PointerEvent): void => {
    // A prior gesture whose `up` was somehow missed must never permanently block input — cancel it.
    if (active) end(e, 'cancel')
    active = true
    pointerId = e.pointerId
    addGestureListeners()
    send('down', norm(e))
  }

  const onMove = (e: PointerEvent): void => {
    if (!active || e.pointerId !== pointerId) return
    latest = norm(e)
    if (!rafScheduled) {
      rafScheduled = true
      requestAnimationFrame(flush)
    }
  }

  const end = (e: PointerEvent, action: 'up' | 'cancel'): void => {
    if (!active || e.pointerId !== pointerId) return
    active = false
    latest = null
    removeGestureListeners()
    send(action, norm(e))
    pointerId = null
  }
  const onUp = (e: PointerEvent): void => end(e, 'up')
  const onCancel = (e: PointerEvent): void => end(e, 'cancel')

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const dims = getDims()
    if (!dims) return
    const r = canvas.getBoundingClientRect()
    void client
      .scroll({
        serial,
        x: (e.clientX - r.left) / r.width,
        y: (e.clientY - r.top) / r.height,
        w: dims.w,
        h: dims.h,
        dx: -Math.sign(e.deltaX) * SCROLL_STEP,
        dy: -Math.sign(e.deltaY) * SCROLL_STEP
      })
      .catch(() => {})
  }

  /** Abort an in-flight gesture without a tap-release (e.g. the device rotated mid-drag). */
  const cancelGesture = (): void => {
    if (!active || pointerId === null) return
    const dims = getDims()
    active = false
    latest = null
    removeGestureListeners()
    if (dims) void client.pointer({ serial, action: 'cancel', x: 0, y: 0, w: dims.w, h: dims.h }).catch(() => {})
    pointerId = null
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  return {
    cancelGesture,
    detach: () => {
      detached = true
      active = false
      latest = null
      removeGestureListeners()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('wheel', onWheel)
    }
  }
}
