import type { ConfigSchema, Field, SelectField } from '@sdk'

/** Field type → HTML input type (anything not listed renders as text). */
const INPUT_TYPE: Record<string, string> = { password: 'password', number: 'number' }

interface Props {
  schema: ConfigSchema
  config: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
}

/**
 * Renders settings from a plugin's declarative config schema using the native
 * macOS "inset grouped" idiom: each field is a row (label left, control right)
 * inside a quiet rounded group, with help text as a footnote below.
 */
export function AutoSettingsForm({ schema, config, onChange }: Props): JSX.Element {
  const entries = Object.entries(schema)
  if (entries.length === 0) {
    return <p className="settings-empty">This widget has no settings.</p>
  }

  return (
    <div className="settings-form">
      {entries.map(([key, f]) => (
        <div className="settings-item" key={key}>
          <div className="settings-group">
            <div className="settings-row">
              <label htmlFor={key} className="settings-row-label">
                {f.label}
              </label>
              <div className="settings-row-control">
                <Control
                  id={key}
                  field={f}
                  value={config[key]}
                  onChange={(v) => onChange({ [key]: v })}
                />
              </div>
            </div>
          </div>
          {f.help && <p className="settings-note">{f.help}</p>}
        </div>
      ))}
    </div>
  )
}

function Control({
  id,
  field: f,
  value,
  onChange
}: {
  id: string
  field: Field
  value: unknown
  onChange: (v: unknown) => void
}): JSX.Element {
  if (f.type === 'boolean') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(value)}
        className={`switch${value ? ' on' : ''}`}
        onClick={() => onChange(!value)}
      >
        <span className="switch-knob" />
      </button>
    )
  }

  if (f.type === 'select') {
    return (
      <select
        id={id}
        className="row-select"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          Select…
        </option>
        {(f as SelectField).options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      id={id}
      className="row-input"
      type={INPUT_TYPE[f.type] ?? 'text'}
      value={String(value ?? '')}
      placeholder={f.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
