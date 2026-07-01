import { useCallback, useEffect, useState } from 'react'
import { Boxes, FolderOpen, HardDriveDownload, ShieldAlert, Terminal, Trash2 } from 'lucide-react'
import type { NativeInstallPlan, InstalledExtension } from '@shared/types/native'
import { resyncNativeExtensions } from '@renderer/native/loader'
import { NativeInstallDialog, NativeEnableDialog } from '@renderer/native/NativeExtDialog'

const DEV_KEY = 'ui.widgetDevMode'

function declaredSummary(e: InstalledExtension): string {
  const d = e.declared
  const parts: string[] = []
  if (d.binaries.length) parts.push(d.binaries.join(', '))
  if (d.network.length) parts.push('network')
  return parts.length ? parts.join(' · ') : 'No binaries or network declared'
}

/** Settings → Extensions: install / enable (full-access consent) / remove native extensions. */
export function ManageExtensions(): JSX.Element {
  const [exts, setExts] = useState<InstalledExtension[]>([])
  const [plan, setPlan] = useState<NativeInstallPlan | null>(null)
  const [enabling, setEnabling] = useState<InstalledExtension | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dev, setDev] = useState(false)

  const refresh = useCallback(async () => {
    setExts(await window.garret.nativeExt.listInstalled())
  }, [])
  useEffect(() => {
    void refresh()
    void window.garret.store.get<boolean>(DEV_KEY).then((v) => setDev(!!v))
  }, [refresh])

  const startFileInstall = async (): Promise<void> => {
    setError(null)
    try {
      const file = await window.garret.pickGarretFile()
      if (!file) return
      const p = await window.garret.nativeExt.planInstallFromFile(file)
      if (!p.ok) return setError(p.error ?? 'Not a valid extension file')
      setPlan(p)
    } catch (e) {
      console.error('[native] planInstallFromFile failed', e)
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const startFolderInstall = async (): Promise<void> => {
    setError(null)
    try {
      const dir = await window.garret.pickDirectory()
      if (!dir) return
      const p = await window.garret.nativeExt.planInstall(dir)
      if (!p.ok) return setError(p.error ?? 'Not a valid extension folder')
      setPlan(p)
    } catch (e) {
      console.error('[native] planInstall failed', e)
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const closePlan = (p: NativeInstallPlan | null): void => {
    if (p?.staged) void window.garret.nativeExt.cleanupInstall(p.source)
    setPlan(null)
  }
  const confirmInstall = async (): Promise<void> => {
    if (!plan) return
    setBusy(true)
    try {
      const res = await window.garret.nativeExt.commitInstall(plan)
      if (plan.staged) void window.garret.nativeExt.cleanupInstall(plan.source)
      setPlan(null)
      if (!res.ok) return setError(res.error ?? 'Install failed')
      await refresh()
    } catch (e) {
      console.error('[native] commitInstall failed', e)
      setPlan(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Enabling is the full-access gate → confirmation dialog. Disabling is instant.
  const toggle = async (e: InstalledExtension): Promise<void> => {
    if (!e.enabled) {
      setError(null)
      setEnabling(e)
      return
    }
    await window.garret.nativeExt.setEnabled(e.id, false)
    await resyncNativeExtensions()
    await refresh()
  }
  const confirmEnable = async (): Promise<void> => {
    if (!enabling) return
    setBusy(true)
    const res = await window.garret.nativeExt.setEnabled(enabling.id, true)
    setBusy(false)
    setEnabling(null)
    if (!res.ok) return setError(res.error ?? 'Could not enable')
    await resyncNativeExtensions()
    await refresh()
  }

  const remove = async (e: InstalledExtension): Promise<void> => {
    if (!window.confirm(`Remove “${e.name}”? Placed instances will show a removed placeholder.`)) return
    await window.garret.nativeExt.remove(e.id)
    await resyncNativeExtensions()
    await refresh()
  }

  return (
    <div className="mw">
      <div className="mw-head">
        <h2 className="mw-title">Extensions</h2>
      </div>

      <div className="mw-banner mw-banner--danger mw-banner--wide">
        <ShieldAlert size={15} strokeWidth={1.9} />
        <span>
          Native extensions run with <strong>full access to your Mac</strong> — no sandbox. Only
          install ones from authors you trust.
        </span>
      </div>

      {exts.length === 0 ? (
        <div className="mw-empty">
          <Boxes size={28} strokeWidth={1.5} />
          <p className="mw-empty-title">No extensions installed</p>
          <p className="mw-empty-sub">
            Install a native extension someone shared. It's added disabled until you enable it.
          </p>
        </div>
      ) : (
        <div className="mw-list">
          {exts.map((e) => (
            <ExtCard key={e.id} e={e} onToggle={() => void toggle(e)} onRemove={() => void remove(e)} />
          ))}
        </div>
      )}

      <div className="mw-install-row">
        <button className="mw-install" onClick={() => void startFileInstall()}>
          <HardDriveDownload size={14} strokeWidth={1.75} /> Install extension…
        </button>
        {dev && (
          <button className="mw-install mw-install--ghost" onClick={() => void startFolderInstall()}>
            <FolderOpen size={14} strokeWidth={1.75} /> Load from folder…
          </button>
        )}
      </div>
      {error && <p className="mw-error">{error}</p>}

      {plan && (
        <NativeInstallDialog
          plan={plan}
          busy={busy}
          onConfirm={() => void confirmInstall()}
          onCancel={() => closePlan(plan)}
        />
      )}
      {enabling && (
        <NativeEnableDialog
          ext={enabling}
          busy={busy}
          onConfirm={() => void confirmEnable()}
          onCancel={() => setEnabling(null)}
        />
      )}
    </div>
  )
}

function ExtCard({
  e,
  onToggle,
  onRemove
}: {
  e: InstalledExtension
  onToggle: () => void
  onRemove: () => void
}): JSX.Element {
  const broken = e.tampered || !e.integrityOk
  return (
    <div className={`mw-card${e.enabled ? '' : ' mw-card--off'}`}>
      <div className="mw-card-main mw-card-main--static">
        <span className="mw-card-icon">
          <Terminal size={20} strokeWidth={1.6} />
        </span>
        <span className="mw-card-body">
          <span className="mw-card-title">
            {e.name} <span className="mw-ver">v{e.version}</span>
            <span className="mw-chip mw-chip--danger mw-chip--sm">Full access</span>
          </span>
          <span className="mw-card-meta">
            <span className="mw-cap">{declaredSummary(e)}</span>
            {e.tampered && <span className="mw-chip mw-chip--danger">Integrity failed</span>}
            {!e.tampered && !e.integrityOk && (
              <span className="mw-chip mw-chip--danger">Unverified record</span>
            )}
          </span>
        </span>
      </div>
      <div className="mw-card-actions" onMouseDown={(ev) => ev.stopPropagation()}>
        <ExtToggle on={e.enabled} disabled={broken && !e.enabled} onChange={onToggle} />
        <button className="mw-icon-btn" title="Remove" onClick={onRemove}>
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

function ExtToggle({
  on,
  disabled,
  onChange
}: {
  on: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <button
      className={`switch${on ? ' on' : ''}${disabled ? ' switch--disabled' : ''}`}
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
    >
      <span className="switch-knob" />
    </button>
  )
}
