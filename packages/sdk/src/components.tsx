import { useState, type ReactNode } from 'react'

/**
 * Ready-made React components for the native Garret widget look. They emit the same class names the
 * app's shared theme styles (`<link rel="stylesheet" href="~theme.css">`), so authors compose UI from
 * components instead of hand-writing markup + memorizing classes. Import from `@garretapp/sdk/react`.
 */

/* ── states ─────────────────────────────────────────────────────────────────────────────────── */

/** Centered muted message (supports rich children). */
export function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return <div className="svc-empty">{children}</div>
}
/** Error message (in the danger color). */
export function ErrorState({ children }: { children: ReactNode }): JSX.Element {
  return <div className="svc-error">{children}</div>
}

/* ── list ───────────────────────────────────────────────────────────────────────────────────── */

export type Tone = 'todo' | 'progress' | 'open' | 'done' | 'merged' | 'declined'

/** Colored status pill (Jira status category / Bitbucket PR state). */
export function StatusPill({ tone = 'todo', children }: { tone?: Tone; children: ReactNode }): JSX.Element {
  return <span className={`status-pill ${tone}`}>{children}</span>
}

/** Vertical scrolling list container for TicketRow items. */
export function List({ children }: { children: ReactNode }): JSX.Element {
  return <div className="ticket-list">{children}</div>
}

/** A single row: a colored dot, a key, a summary, and a trailing status pill — all optional. */
export function TicketRow(props: {
  dot?: Tone
  itemKey?: ReactNode
  summary: ReactNode
  status?: { tone?: Tone; label: ReactNode }
  onOpen?: () => void
}): JSX.Element {
  const { dot, itemKey, summary, status, onOpen } = props
  return (
    <button className="ticket" onClick={onOpen}>
      {dot && <span className={`ticket-dot ${dot}`} />}
      {itemKey != null && <span className="ticket-key">{itemKey}</span>}
      <span className="ticket-summary">{summary}</span>
      {status && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
    </button>
  )
}

/** A collapsible section with a header (title + optional count) and a rotating chevron. Uncontrolled. */
export function CollapsibleGroup({
  title,
  count,
  defaultOpen = true,
  children
}: {
  title: ReactNode
  count?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button className="pr-group-head" onClick={() => setOpen((o) => !o)}>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: 'var(--text-3)', flexShrink: 0, transform: open ? 'rotate(90deg)' : '', transition: 'transform .12s' }}
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
        <span className="pr-group-name">{title}</span>
        {count != null && <span className="pr-group-count">{count}</span>}
      </button>
      {open && <div className="pr-group-body">{children}</div>}
    </div>
  )
}

/* ── settings form ──────────────────────────────────────────────────────────────────────────── */

/** The container a widget renders when the host opens its settings (see `useOpenSettings`). Adds a
 *  footer with a Done button. */
export function SettingsPanel({ onDone, children }: { onDone: () => void; children: ReactNode }): JSX.Element {
  return (
    <div className="settings-form">
      {children}
      <div className="settings-footer">
        <span className="settings-saved">Changes save automatically</span>
        <button className="settings-done" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )
}
/** An inset grouped container (System-Settings style). Group related SettingsRows. */
export function SettingsGroup({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="settings-item">
      <div className="settings-group">{children}</div>
    </div>
  )
}
export function SettingsRow({ label, children }: { label: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="settings-row">
      <label className="settings-row-label">{label}</label>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}
/** Uncontrolled text field — commits on blur / Enter (so typing doesn't churn state on each keystroke). */
export function TextField({
  value,
  placeholder,
  secret,
  onCommit
}: {
  value?: string
  placeholder?: string
  secret?: boolean
  onCommit: (v: string) => void
}): JSX.Element {
  return (
    <input
      className="row-input"
      type={secret ? 'password' : 'text'}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onCommit((e.target as HTMLInputElement).value)}
    />
  )
}
export function NumberField({ value, onCommit }: { value?: number; onCommit: (v: number) => void }): JSX.Element {
  return (
    <input
      className="row-input"
      type="number"
      defaultValue={value == null ? '' : String(value)}
      onBlur={(e) => onCommit(Number(e.target.value) || 0)}
    />
  )
}
export function SelectField({
  value,
  options,
  onChange
}: {
  value: string
  options: [value: string, label: string][]
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <select className="row-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}
export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  )
}
