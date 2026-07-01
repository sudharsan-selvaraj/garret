import { useCallback, useEffect, useRef } from 'react'
import { Rnd } from 'react-rnd'

/**
 * THROWAWAY SPIKE tile (see src/main/spike/wcvSpike.ts). A normal draggable/resizable board tile
 * whose "body" is backed by a main-process WebContentsView instead of a <webview>. It reports its
 * placeholder rect to main on EVERY drag/resize/scroll frame with no throttle and no hide — the
 * worst case — so we can eyeball whether the OS-layer view tracks the DOM placeholder smoothly.
 *
 * Watch for: (1) does the green-bordered view sit exactly on the dashed placeholder while dragging?
 * (2) does it stay glued while you SCROLL the board? (3) does the readout px match the tile size?
 */
const ID = 'spike-1'

export function WcvSpikeTile(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  const sync = useCallback(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    void window.garret.wcvSpike.setBounds(ID, { x: r.left, y: r.top, width: r.width, height: r.height })
  }, [])

  useEffect(() => {
    let alive = true
    void window.garret.wcvSpike.create(ID).then(() => {
      if (alive) sync()
    })
    // capture:true so we catch scrolling on ANY ancestor scroll container, not just window.
    const onScrollOrResize = (): void => sync()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    const ro = new ResizeObserver(sync)
    if (ref.current) ro.observe(ref.current)
    return () => {
      alive = false
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      ro.disconnect()
      void window.garret.wcvSpike.destroy(ID)
    }
  }, [sync])

  // Finding #1 (kept in the layout): a WebContentsView is ALWAYS on top of its rect and captures
  // pointer events, so DOM chrome can't live UNDER it. Realistic shape: a DOM header ABOVE the view
  // (the drag handle, always grabbable), and the view fills only the BODY rect below it.
  return (
    <Rnd
      className="rnd-item"
      default={{ x: 140, y: 140, width: 380, height: 300 }}
      bounds="parent"
      dragHandleClassName="wcv-spike-drag"
      minWidth={180}
      minHeight={140}
      onDrag={sync} // LIVE per-frame sync — measuring the worst case (no hide-on-drag)
      onDragStop={sync}
      onResize={sync}
      onResizeStop={sync}
    >
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div
          className="wcv-spike-drag"
          style={{
            height: 30,
            flex: '0 0 auto',
            cursor: 'grab',
            background: '#2a2a30',
            borderRadius: '10px 10px 0 0',
            color: '#fff',
            font: '11px -apple-system',
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            gap: 6
          }}
        >
          ↕ DOM header (drag me) · view fills the body ↓
        </div>
        {/* The WebContentsView (green border) tracks THIS body rect. Dashed = where it should sit. */}
        <div
          ref={ref}
          style={{
            flex: 1,
            border: '2px dashed rgba(255,255,255,0.5)',
            borderTop: 'none',
            borderRadius: '0 0 10px 10px'
          }}
        />
      </div>
    </Rnd>
  )
}
