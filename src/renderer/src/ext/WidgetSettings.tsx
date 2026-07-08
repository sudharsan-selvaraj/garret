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
  const [secretsSet, setSecretsSet] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    void window.garret.ext.settingsGet(widget.fullId).then((v) => alive && setValues(v))
    // Secret values are never returned to the UI — only which keys are set (so we can show "Saved").
    void window.garret.ext.secretKeys(widget.fullId).then((k) => alive && setSecretsSet(new Set(k)))
    return () => {
      alive = false
    }
  }, [widget.fullId])

  const update = (key: string, val: unknown): void => {
    setValues((v) => ({ ...v, [key]: val }))
    void window.garret.ext.settingsSet(widget.fullId, { [key]: val })
  }
  const saveSecret = (key: string, val: string): void => {
    void window.garret.ext.secretSet(widget.fullId, key, val).then(() =>
      setSecretsSet((s) => new Set(s).add(key))
    )
  }

  return (
    <section className="ws-section">
      <p className="settings-section-label">{widget.name}</p>
      <div className="settings-group">
        {schema.map((f) => (
          <div className="settings-row" key={f.key}>
            <label className="settings-row-label">{f.label}</label>
            <div className="settings-row-control">
              {f.type === 'secret' ? (
                <SecretField field={f} isSet={secretsSet.has(f.key)} onSave={(v) => saveSecret(f.key, v)} />
              ) : (
                <Field field={f} value={values[f.key] ?? f.default} onChange={(v) => update(f.key, v)} />
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** A write-only secret input: it never shows the stored value. Typing + blur/Enter saves it to the
 *  encrypted store, then the field clears and shows "Saved" (enter a new value to replace). */
function SecretField({
  field,
  isSet,
  onSave
}: {
  field: SettingsField
  isSet: boolean
  onSave: (v: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(isSet)
  const commit = (): void => {
    if (!draft) return
    onSave(draft)
    setDraft('')
    setSaved(true)
  }
  return (
    <div className="ws-secret">
      <input
        className="row-input"
        type="password"
        value={draft}
        placeholder={saved ? 'Saved — enter to replace' : (field.placeholder ?? '')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {saved && <span className="ws-secret-ok">Saved</span>}
    </div>
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
