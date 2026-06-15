import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ContextMenuProps {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
}

/** A floating menu anchored at (x, y), clamped to the viewport. Closes on outside-click / Escape. */
export function ContextMenu({ x, y, onClose, children }: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8)
    })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('contextmenu', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('contextmenu', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Portal to <body> so the fixed-position menu isn't clipped/offset by the
  // widget's transformed + overflow-hidden + backdrop-filtered ancestors.
  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {children}
    </div>,
    document.body
  )
}

export function MenuItem({
  icon,
  label,
  onClick,
  danger,
  trailing
}: {
  icon?: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  trailing?: ReactNode
}): JSX.Element {
  return (
    <button className={`ctx-item${danger ? ' danger' : ''}`} role="menuitem" onClick={onClick}>
      <span className="ctx-icon">{icon}</span>
      <span className="ctx-label">{label}</span>
      {trailing && <span className="ctx-trailing">{trailing}</span>}
    </button>
  )
}

export function MenuSeparator(): JSX.Element {
  return <div className="ctx-sep" />
}

/** A non-closing row hosting custom controls (e.g. an opacity slider). */
export function MenuRow({ children }: { children: ReactNode }): JSX.Element {
  return <div className="ctx-row">{children}</div>
}
