import { useState, type ReactNode } from 'react'

/**
 * Garret widget design system — GENERIC React building blocks that emit the classes the app's shared
 * theme styles (`<link rel="stylesheet" href="~theme.css">`). No widget-specific components: these are
 * primitives (rows, badges, accordions, a settings-form kit) that consumers compose into their own UI.
 * Import from `@garretapp/sdk/react`.
 */

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

/* ── states ─────────────────────────────────────────────────────────────────────────────────── */

/** Centered muted message (supports rich children). The inner wrapper keeps the message a single flow
 *  so it centers as one block (rather than each inline piece becoming its own flex/grid line). */
export function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="gx-empty">
      <div className="gx-empty-msg">{children}</div>
    </div>
  )
}
/** Error message (in the danger color). */
export function ErrorState({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="gx-error">
      <div className="gx-empty-msg">{children}</div>
    </div>
  )
}

/* ── layout ─────────────────────────────────────────────────────────────────────────────────── */

/** A scrolling content region. */
export function Scroll({ children }: { children: ReactNode }): JSX.Element {
  return <div className="gx-scroll">{children}</div>
}

/** A generic list row: optional `leading` / `trailing` slots around the content. Interactive (hover +
 *  pointer) when `onClick` is given. Renders a <button> if clickable, else a <div>. */
export function Item({
  leading,
  trailing,
  onClick,
  onContextMenu,
  children
}: {
  leading?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  children: ReactNode
}): JSX.Element {
  const cls = `gx-item${onClick ? ' gx-item--interactive' : ''}`
  const inner = (
    <>
      {leading}
      <span className="gx-item-content">{children}</span>
      {trailing}
    </>
  )
  return onClick ? (
    <button className={cls} onClick={onClick} onContextMenu={onContextMenu}>
      {inner}
    </button>
  ) : (
    <div className={cls} onContextMenu={onContextMenu}>
      {inner}
    </div>
  )
}

/** A collapsible section: a header (title + optional `aside`, e.g. a count) and a rotating chevron. */
export function Accordion({
  title,
  aside,
  defaultOpen = true,
  children
}: {
  title: ReactNode
  aside?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button className="gx-accordion-head" onClick={() => setOpen((o) => !o)}>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: 'var(--gx-text-3)', flexShrink: 0, transform: open ? 'rotate(90deg)' : '', transition: 'transform .12s' }}
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
        <span className="gx-accordion-title">{title}</span>
        {aside != null && <span className="gx-accordion-aside">{aside}</span>}
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

/** A thin status strip shown ABOVE content that already has data: a "couldn't refresh" notice
 *  (stale-while-error) or a subtle "refreshing" hint. Renders nothing when fresh + idle. Pair with
 *  `usePoll` — pass its `{ error, loading, refresh }`. */
export function StatusStrip({
  error,
  loading,
  onRetry
}: {
  error?: string
  loading?: boolean
  onRetry?: () => void
}): JSX.Element | null {
  if (error) {
    return (
      <div className="gx-status gx-status--error">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
        </svg>
        <span>Couldn’t refresh — showing last update</span>
        {onRetry && (
          <button className="gx-status-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    )
  }
  if (loading) {
    return (
      <div className="gx-status">
        <svg className="gx-status-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span>Refreshing…</span>
      </div>
    )
  }
  return null
}

/* ── feedback ───────────────────────────────────────────────────────────────────────────────── */

/** A small pill; `tone` sets the color. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }): JSX.Element {
  return <span className={`gx-badge gx-badge--${tone}`}>{children}</span>
}
/** A small status dot; same tones. */
export function Dot({ tone = 'neutral', title }: { tone?: Tone; title?: string }): JSX.Element {
  return <span className={`gx-dot gx-dot--${tone}`} title={title} />
}

/* ── settings form ──────────────────────────────────────────────────────────────────────────── */

/** The container a widget renders when the host opens its settings (see `useOpenSettings`). Adds a
 *  footer with a Done button. */
export function SettingsPanel({ onDone, children }: { onDone: () => void; children: ReactNode }): JSX.Element {
  return (
    <div className="gx-form">
      {children}
      <div className="gx-form-footer">
        <span className="gx-form-note">Changes save automatically</span>
        <button className="gx-btn" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )
}
/** An inset grouped container (System-Settings style). Group related Fields; `label` is optional. */
export function FieldGroup({ label, children }: { label?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="gx-group-wrap">
      {label != null && <span className="gx-group-label">{label}</span>}
      <div className="gx-group">{children}</div>
    </div>
  )
}
export function Field({ label, children }: { label: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="gx-field">
      <label className="gx-field-label">{label}</label>
      <div className="gx-field-control">{children}</div>
    </div>
  )
}
/** Uncontrolled text input — commits on blur / Enter (so typing doesn't churn state per keystroke). */
export function TextInput({
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
      className="gx-input"
      type={secret ? 'password' : 'text'}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onCommit((e.target as HTMLInputElement).value)}
    />
  )
}
export function NumberInput({ value, onCommit }: { value?: number; onCommit: (v: number) => void }): JSX.Element {
  return (
    <input
      className="gx-input"
      type="number"
      defaultValue={value == null ? '' : String(value)}
      onBlur={(e) => onCommit(Number(e.target.value) || 0)}
    />
  )
}
export function Select({
  value,
  options,
  onChange
}: {
  value: string
  options: [value: string, label: string][]
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <select className="gx-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}
export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button className={`gx-switch${on ? ' gx-switch--on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="gx-switch-knob" />
    </button>
  )
}

/** One declarative settings field for `AutoForm`. */
export type FieldSpec =
  | { key: string; label: string; type: 'text' | 'secret'; placeholder?: string }
  | { key: string; label: string; type: 'number' }
  | { key: string; label: string; type: 'select'; options: [value: string, label: string][] }
  | { key: string; label: string; type: 'switch' }

/** Render a settings form from a declarative schema — a convenience over hand-composing Field +
 *  inputs. `value` supplies current values by key; `onChange` gets a shallow patch. Compose freely
 *  with your own Fields (wrap in FieldGroup / SettingsPanel as you like). */
export function AutoForm<T extends Record<string, unknown>>({
  schema,
  value,
  onChange
}: {
  schema: FieldSpec[]
  value: T
  onChange: (patch: Partial<T>) => void
}): JSX.Element {
  return (
    <FieldGroup>
      {schema.map((f) => (
        <Field key={f.key} label={f.label}>
          {f.type === 'select' ? (
            <Select value={String(value[f.key] ?? '')} options={f.options} onChange={(v) => onChange({ [f.key]: v } as Partial<T>)} />
          ) : f.type === 'switch' ? (
            <Switch on={Boolean(value[f.key])} onChange={(v) => onChange({ [f.key]: v } as Partial<T>)} />
          ) : f.type === 'number' ? (
            <NumberInput value={value[f.key] as number | undefined} onCommit={(v) => onChange({ [f.key]: v } as Partial<T>)} />
          ) : (
            <TextInput
              value={value[f.key] as string | undefined}
              placeholder={f.placeholder}
              secret={f.type === 'secret'}
              onCommit={(v) => onChange({ [f.key]: v } as Partial<T>)}
            />
          )}
        </Field>
      ))}
    </FieldGroup>
  )
}
