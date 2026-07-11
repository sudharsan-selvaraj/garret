import { type CSSProperties, type ReactNode } from 'react'
import type { AnyWidgetPlugin } from '@sdk'

// Lightweight, representative mocks of how each built-in widget looks — used only
// in the Add dialog's preview pane. They render placeholder data (no fetching),
// so they're stable and fast. Widgets without a mock fall back to a big icon.

const ellip: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}
const dim: CSSProperties = { color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }

function Row({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 2px',
        fontSize: 11,
        boxShadow: 'inset 0 -0.5px 0 var(--hairline)'
      }}
    >
      {children}
    </div>
  )
}

const calendar = (): JSX.Element => (
  <>
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '6px 8px',
        borderLeft: '2px solid var(--accent)',
        background: 'rgba(10,132,255,0.12)',
        borderRadius: 6,
        fontSize: 11
      }}
    >
      <span style={{ ...dim, color: 'var(--accent)', fontWeight: 600 }}>NOW</span>
      <span style={ellip}>Team sync</span>
    </div>
    <Row>
      <span style={dim}>10:30</span>
      <span style={ellip}>Project review</span>
    </Row>
    <Row>
      <span style={dim}>14:00</span>
      <span style={ellip}>1:1</span>
    </Row>
  </>
)

const git = (): JSX.Element => (
  <>
    <Row>
      <span style={ellip}>web-app</span>
      <span style={dim}>main ↑2</span>
    </Row>
    <Row>
      <span style={ellip}>api-service</span>
      <span style={dim}>feature ↑1 ↓3</span>
    </Row>
  </>
)

const PREVIEWS: Record<string, () => JSX.Element> = {
  calendar,
  'git-repo': git
}

// Small/object-like widgets stay compact instead of stretching to full width.
const COMPACT = new Set<string>()

/**
 * Preview of a widget's layout for the Add dialog: a hand-authored mock for built-ins, or NOTHING
 * (just the info row) when there's no mock — no empty placeholder box.
 */
export function WidgetPreview({ plugin }: { plugin: AnyWidgetPlugin }): JSX.Element | null {
  const { id } = plugin.manifest
  const Mock = PREVIEWS[id]
  const cls = `add-preview-card${COMPACT.has(id) ? ' add-preview-card--compact' : ''}`

  if (Mock) return <div className={cls}><Mock /></div>
  return null
}
