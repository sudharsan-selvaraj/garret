import { useEffect, useState } from 'react'
import type { InstalledPack, SettingsField } from '@shared/types/ext'

/**
 * The per-pack settings pane (Settings → <pack>). One section per widget that declares a
 * `settings.schema`, plus (if the pack declares `shared`) a single pack-wide "Account" section — so a
 * multi-widget service pack holds ONE credential set. Non-secret values persist to the store the
 * widget reads via `g.storage`/`g.shared.storage`; `type:"secret"` fields go to the encrypted store
 * (`g.secrets`/`g.shared.secrets`) and are never read back into the UI.
 */
export function WidgetSettings({ pack }: { pack: InstalledPack }): JSX.Element {
  const widgetSections = pack.widgets.filter((w) => (w.settingsSchema?.length ?? 0) > 0)
  const sharedSchema = pack.sharedSettingsSchema ?? []
  const g = window.garret.ext
  return (
    <div className="ws" key={pack.id}>
      <div className="ws-head">
        <h3>{pack.name}</h3>
        <span className="ws-pub">{pack.publisher}</span>
      </div>
      {widgetSections.length === 0 && sharedSchema.length === 0 ? (
        <p className="ws-empty">This pack has no settings.</p>
      ) : (
        <>
          {sharedSchema.length > 0 && (
            <SettingsForm
              scopeKey={`${pack.id}:shared`}
              title="Account"
              schema={sharedSchema}
              io={{
                get: () => g.sharedGet(pack.id),
                set: (patch) => g.sharedSet(pack.id, patch),
                secretSet: (k, v) => g.sharedSecretSet(pack.id, k, v),
                secretKeys: () => g.sharedSecretKeys(pack.id)
              }}
            />
          )}
          {widgetSections.map((w) => (
            <SettingsForm
              key={w.fullId}
              scopeKey={w.fullId}
              title={w.name}
              schema={w.settingsSchema ?? []}
              io={{
                get: () => g.settingsGet(w.fullId),
                set: (patch) => g.settingsSet(w.fullId, patch),
                secretSet: (k, v) => g.secretSet(w.fullId, k, v),
                secretKeys: () => g.secretKeys(w.fullId)
              }}
            />
          ))}
        </>
      )}
    </div>
  )
}

interface SettingsIO {
  get: () => Promise<Record<string, unknown>>
  set: (patch: Record<string, unknown>) => Promise<void>
  secretSet: (key: string, value: string) => Promise<void>
  secretKeys: () => Promise<string[]>
}

/** One settings section (a widget's, or the pack-shared "Account") — a form over a SettingsIO. */
function SettingsForm({
  scopeKey,
  title,
  schema,
  io
}: {
  scopeKey: string
  title: string
  schema: SettingsField[]
  io: SettingsIO
}): JSX.Element {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [secretsSet, setSecretsSet] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    void io.get().then((v) => alive && setValues(v))
    // Secret values are never returned to the UI — only which keys are set (so we can show "Saved").
    void io.secretKeys().then((k) => alive && setSecretsSet(new Set(k)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])

  const update = (key: string, val: unknown): void => {
    setValues((v) => ({ ...v, [key]: val }))
    void io.set({ [key]: val })
  }
  const saveSecret = (key: string, val: string): void => {
    void io.secretSet(key, val).then(() => setSecretsSet((s) => new Set(s).add(key)))
  }

  return (
    <section className="ws-section">
      <p className="settings-section-label">{title}</p>
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
