import { useCallback, useEffect, useState, type ComponentType } from 'react'
import {
  Blocks,
  Database,
  FolderOpen,
  Globe,
  KeyRound,
  ShieldCheck,
  SquareArrowOutUpRight,
  Trash2
} from 'lucide-react'
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

/** Icon for a declared permission (consent screen rows). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function permIcon(p: string): ComponentType<any> {
  if (p.startsWith('service:')) return KeyRound
  if (p.startsWith('network:')) return Globe
  if (p === 'files:read') return FolderOpen
  if (p === 'openExternal') return SquareArrowOutUpRight
  return ShieldCheck
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
                {w.tampered && (
                  <div className="ext-blocked">⚠ Integrity check failed — reinstall this widget.</div>
                )}
                {w.attemptedBlocked.length > 0 && (
                  <div className="ext-blocked">
                    Tried (blocked): {w.attemptedBlocked.map(describePermission).join(' · ')}
                  </div>
                )}
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
  const cap = (p: string): JSX.Element => {
    const Icon = permIcon(p)
    return (
      <li key={p} className="consent-cap">
        <span className="consent-cap-ic">
          <Icon size={14} strokeWidth={1.75} />
        </span>
        <span>{describePermission(p)}</span>
      </li>
    )
  }

  return (
    <div className="consent-backdrop" onClick={onCancel}>
      <div className="consent-card" onClick={(e) => e.stopPropagation()}>
        <div className="consent-head">
          <span className="consent-icon">
            <Blocks size={22} strokeWidth={1.75} />
          </span>
          <div className="consent-head-text">
            <h3 className="consent-title">
              {plan.isUpdate ? 'Update' : 'Install'} “{plan.name}”?
            </h3>
            <div className="consent-source" title={plan.source}>
              v{plan.version} · {plan.source}
            </div>
          </div>
        </div>

        <div className="consent-badge">
          <ShieldCheck size={13} strokeWidth={2} /> Runs sandboxed &amp; isolated · unverified author
        </div>

        <p className="consent-h">This widget can</p>
        <ul className="consent-caps">
          {plan.permissions.map(cap)}
          <li className="consent-cap consent-cap--muted">
            <span className="consent-cap-ic">
              <Database size={14} strokeWidth={1.75} />
            </span>
            <span>Store its own settings locally (isolated to this widget)</span>
          </li>
          {plan.permissions.length === 0 && (
            <li className="consent-cap consent-cap--muted">
              <span className="consent-cap-ic">
                <ShieldCheck size={14} strokeWidth={1.75} />
              </span>
              <span>Nothing else — no network or account access</span>
            </li>
          )}
        </ul>

        {plan.isUpdate && plan.addedPermissions.length > 0 && (
          <>
            <p className="consent-h consent-new">New access since you installed it</p>
            <ul className="consent-caps consent-caps--new">{plan.addedPermissions.map(cap)}</ul>
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
