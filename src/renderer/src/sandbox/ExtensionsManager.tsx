import { useCallback, useEffect, useState } from 'react'
import { Blocks, Trash2 } from 'lucide-react'
import type { InstallPlan, InstalledWidget } from '@shared/types/sandbox'
import { resyncSandboxedWidgets } from '@renderer/sandbox/loader'

/** Plain-language description of a declared permission for the consent screen. */
export function describePermission(p: string): string {
  if (p.startsWith('service:')) return `Read your ${p.slice('service:'.length)} data`
  if (p.startsWith('network:')) return `Connect to ${p.slice('network:'.length)}`
  if (p === 'files:read') return 'Read files you point it at'
  if (p === 'openExternal') return 'Open links in your browser (asks each time)'
  return p
}

/** Settings pane: list/install/enable-disable/remove sandboxed (third-party) widgets. */
export function ExtensionsManager(): JSX.Element {
  const [widgets, setWidgets] = useState<InstalledWidget[]>([])
  const [plan, setPlan] = useState<InstallPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setWidgets(await window.garret.sandbox.list())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const startInstall = async (): Promise<void> => {
    setError(null)
    const dir = await window.garret.pickDirectory()
    if (!dir) return
    const p = await window.garret.sandbox.planInstall(dir)
    if (!p.ok) {
      setError(p.error ?? 'Not a valid widget folder')
      return
    }
    setPlan(p)
  }

  const confirmInstall = async (): Promise<void> => {
    if (!plan) return
    setBusy(true)
    const res = await window.garret.sandbox.commitInstall(plan)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Install failed')
      setPlan(null)
      return
    }
    setPlan(null)
    await resyncSandboxedWidgets()
    await refresh()
  }

  const remove = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`Remove “${name}”? Placed instances will show a removed placeholder.`)) return
    await window.garret.sandbox.remove(id)
    await resyncSandboxedWidgets()
    await refresh()
  }

  const toggle = async (w: InstalledWidget): Promise<void> => {
    await window.garret.sandbox.setEnabled(w.id, !w.enabled)
    await resyncSandboxedWidgets()
    await refresh()
  }

  return (
    <>
      <p className="settings-section-label">Widgets</p>
      <div className="settings-group">
        {widgets.length === 0 && <div className="ext-empty">No third-party widgets installed.</div>}
        {widgets.map((w) => {
          const name = String(w.manifest.name ?? w.id)
          return (
            <div key={w.id} className="ext-row">
              <div className="ext-info">
                <div className="ext-name">
                  {name} <span className="ext-ver">v{w.version}</span>
                </div>
                <div className="ext-perms">
                  {w.consentedPermissions.length
                    ? w.consentedPermissions.map(describePermission).join(' · ')
                    : 'No network or account access'}
                </div>
              </div>
              <div className="ext-actions">
                <ExtToggle on={w.enabled} onChange={() => void toggle(w)} />
                <button className="ext-remove" title="Remove" onClick={() => void remove(w.id, name)}>
                  <Trash2 size={15} strokeWidth={1.75} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <button className="ext-install" onClick={() => void startInstall()}>
        <Blocks size={14} strokeWidth={1.75} /> Install widget…
      </button>
      {error && <p className="ext-error">{error}</p>}
      <p className="settings-note">
        Third-party widgets run sandboxed and isolated — they only get the access you approve
        at install. Authors are unverified; only install widgets you trust.
      </p>

      {plan && (
        <ConsentDialog
          plan={plan}
          busy={busy}
          onConfirm={() => void confirmInstall()}
          onCancel={() => setPlan(null)}
        />
      )}
    </>
  )
}

function ConsentDialog({
  plan,
  busy,
  onConfirm,
  onCancel
}: {
  plan: InstallPlan
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <div className="consent-backdrop" onClick={onCancel}>
      <div className="consent-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="consent-title">
          {plan.isUpdate ? 'Update' : 'Install'} “{plan.name}”?
        </h3>
        <p className="consent-meta">
          v{plan.version} · {plan.source}
        </p>
        <p className="consent-warn">
          Runs sandboxed &amp; isolated. Unverified author — only install widgets you trust.
        </p>
        <p className="consent-h">This widget can:</p>
        <ul className="consent-perms">
          {plan.permissions.map((p) => (
            <li key={p}>{describePermission(p)}</li>
          ))}
          <li>Store its own settings locally (isolated to this widget)</li>
          {plan.permissions.length === 0 && <li>Nothing else — no network or account access</li>}
        </ul>
        {plan.isUpdate && plan.addedPermissions.length > 0 && (
          <>
            <p className="consent-h consent-new">New access since you installed it:</p>
            <ul className="consent-perms consent-perms--new">
              {plan.addedPermissions.map((p) => (
                <li key={p}>{describePermission(p)}</li>
              ))}
            </ul>
          </>
        )}
        <div className="consent-actions">
          <button className="consent-cancel" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="consent-install" onClick={onConfirm} disabled={busy}>
            {busy ? 'Installing…' : plan.isUpdate ? 'Update' : 'Install'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ExtToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="switch-knob" />
    </button>
  )
}
