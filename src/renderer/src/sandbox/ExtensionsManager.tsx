import { useCallback, useEffect, useState } from 'react'
import { Blocks, FolderOpen, Trash2 } from 'lucide-react'
import type { InstallPlan, InstalledWidget } from '@shared/types/sandbox'
import { resyncSandboxedWidgets } from '@renderer/sandbox/loader'
import { ConsentDialog, describePermission } from '@renderer/sandbox/ConsentDialog'
import { commitPlan, cancelPlan } from '@renderer/sandbox/installActions'

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

  const startFileInstall = async (): Promise<void> => {
    setError(null)
    const file = await window.garret.pickGarretFile()
    if (!file) return
    const p = await window.garret.sandbox.installFromFile(file)
    if (!p.ok) {
      setError(p.error ?? 'Not a valid .garret file')
      return
    }
    setPlan(p)
  }

  // Discard a pending plan, cleaning up the .garret staging temp dir if it was staged.
  const closePlan = (p: InstallPlan | null): void => {
    if (p) cancelPlan(p)
    setPlan(null)
  }

  const confirmInstall = async (): Promise<void> => {
    if (!plan) return
    setBusy(true)
    const res = await commitPlan(plan)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Install failed')
      setPlan(null)
      return
    }
    setPlan(null)
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
      <div className="ext-install-row">
        <button className="ext-install" onClick={() => void startFileInstall()}>
          <Blocks size={14} strokeWidth={1.75} /> Install .garret file…
        </button>
        <button className="ext-install ext-install--ghost" onClick={() => void startInstall()}>
          <FolderOpen size={14} strokeWidth={1.75} /> From folder…
        </button>
      </div>
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
          onCancel={() => closePlan(plan)}
        />
      )}
    </>
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
