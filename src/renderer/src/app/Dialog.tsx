import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}

/** Modal overlay shell. Closes on Escape or a backdrop click. */
export function Dialog({ title, onClose, children, className }: DialogProps): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="app-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`dialog-panel${className ? ` ${className}` : ''}`} role="dialog" aria-label={title}>
        <header className="dialog-header">
          <span className="dialog-title">{title}</span>
          <button className="dialog-close" onClick={onClose} title="Close">
            <X size={16} strokeWidth={1.75} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  )
}
