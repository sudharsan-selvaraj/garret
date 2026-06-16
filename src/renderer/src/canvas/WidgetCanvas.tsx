import { useMemo, useState } from 'react'
import { Rnd } from 'react-rnd'
import { useBoardStore } from '@renderer/canvas/useBoardStore'
import { WidgetHost } from '@renderer/widgets/WidgetHost'

// Extra space beyond the furthest widget so the canvas stays scrollable and you
// have room to drag widgets into new territory (the container grows on drop).
const CANVAS_PADDING = 220

/** Free-positioned (Rainmeter-style) canvas: each widget is dragged/resized anywhere. */
export function WidgetCanvas(): JSX.Element {
  const widgets = useBoardStore((s) => s.widgets)
  const updateFrame = useBoardStore((s) => s.updateFrame)

  // While dragging/resizing, disable pointer events on webviews so the gesture
  // isn't swallowed by a <webview> (a separate web contents).
  const [interacting, setInteracting] = useState(false)

  // Size the canvas to span all widgets so the container can scroll to reach
  // anything past the screen edge; CSS floors it at the viewport (so it only
  // scrolls when content actually overflows). Drag-room padding is added ONLY
  // while interacting, so a board that fits shows no scrollbar at rest.
  const extent = useMemo(() => {
    let width = 0
    let height = 0
    for (const w of widgets) {
      width = Math.max(width, w.x + w.width)
      height = Math.max(height, w.y + w.height)
    }
    const pad = interacting ? CANVAS_PADDING : 0
    return { width: width + pad, height: height + pad }
  }, [widgets, interacting])

  if (widgets.length === 0) {
    return (
      <div className="canvas-empty">
        <p>No widgets yet.</p>
        <p className="canvas-empty-hint">Use “+ Add” to drop one onto your desktop.</p>
      </div>
    )
  }

  return (
    <div
      className={`free-canvas${interacting ? ' is-interacting' : ''}`}
      style={{ width: extent.width, height: extent.height }}
    >
      {widgets.map((w) => (
        <Rnd
          key={w.id}
          className="rnd-item"
          size={{ width: w.width, height: w.height }}
          position={{ x: w.x, y: w.y }}
          bounds="parent"
          dragHandleClassName="widget-drag"
          disableDragging={w.locked}
          enableResizing={!w.locked}
          minWidth={180}
          minHeight={120}
          onDragStart={() => setInteracting(true)}
          onDragStop={(_e, d) => {
            setInteracting(false)
            updateFrame(w.id, { x: d.x, y: d.y, width: w.width, height: w.height })
          }}
          onResizeStart={() => setInteracting(true)}
          onResizeStop={(_e, _dir, ref, _delta, pos) => {
            setInteracting(false)
            updateFrame(w.id, {
              x: pos.x,
              y: pos.y,
              width: ref.offsetWidth,
              height: ref.offsetHeight
            })
          }}
        >
          <WidgetHost widget={w} />
        </Rnd>
      ))}
    </div>
  )
}
