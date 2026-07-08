import { useEffect, useState } from 'react'
import type { InstalledPack, InstalledPackWidget, SettingsField } from '@shared/types/ext'

/**
 * The per-pack settings pane (Settings → <pack>). Renders one section per widget that declares a
 * `settings.schema`, as a form. Values load via ext.settingsGet and persist per-widget via
 * ext.settingsSet — the same storage the widget reads through `g.storage`, so settings are isolated
 * per widget and shared across that widget's placements.
 */
export function WidgetSettings({ pack }: { pack: InstalledPack }): JSX.Element {
  const sections = pack.widgets.filter((w) => (w.settingsSchema?.length ?? 0) > 0)
  return (
    <div className="ws" key={pack.id}>
      <div className="ws-head">
        <h3>{pack.name}</h3>
        <span className="ws-pub">{pack.publisher}</span>
      </div>
      {sections.length === 0 ? (
        <p className="ws-empty">This pack has no settings.</p>
      ) : (
        sections.map((w) => <WidgetSection key={w.fullId} widget={w} />)
      )}
    </div>
  )
}

function WidgetSection({ widget }: { widget: InstalledPackWidget }): JSX.Element {
  const schema = widget.settingsSchema ?? []
  const [values, setValues] = useState<Record<string, unknown>>({})

  useEffect(() => {
    let alive = true
    void window.garret.ext.settingsGet(widget.fullId).then((v) => alive && setValues(v))
    return () => {
      alive = false
    }
  }, [widget.fullId])

  const update = (key: string, val: unknown): void => {
    setValues((v) => ({ ...v, [key]: val }))
    void window.garret.ext.settingsSet(widget.fullId, { [key]: val })
  }

  return (
    <section className="ws-section">
      <p className="settings-section-label">{widget.name}</p>
      <div className="settings-group">
        {schema.map((f) => (
          <div className="settings-row" key={f.key}>
            <label className="settings-row-label">{f.label}</label>
            <div className="settings-row-control">
              <Field field={f} value={values[f.key] ?? f.default} onChange={(v) => update(f.key, v)} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Field({
  field,
  value,
  onChange
}: {
  field: SettingsField
  value: unknown
  onChange: (v: unknown) => void
}): JSX.Element {
  switch (field.type) {
    case 'boolean':
      return (
        <button
          className={`switch${value ? ' on' : ''}`}
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(!value)}
        >
          <span className="switch-knob" />
        </button>
      )
    case 'select':
      return (
        <select className="row-select" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    case 'number':
      return (
        <input
          className="row-input"
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )
    default: // 'string' | 'secret'
      return (
        <input
          className="row-input"
          type={field.type === 'secret' ? 'password' : 'text'}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

export type { InstalledPack }
