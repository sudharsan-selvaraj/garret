import { useCallback, useEffect, useState } from 'react'
import { Blocks, FolderOpen, HardDriveDownload, ShieldAlert, Store, Trash2 } from 'lucide-react'
import type { ExtInstallPlan, InstalledExtension, MarketplaceEntry } from '@shared/types/ext'
import { resyncExtensions } from '@renderer/ext/loader'
import { InstallDialog, EnableDialog, needsEnableConsent } from '@renderer/ext/ExtDialogs'

const DEV_KEY = 'ui.widgetDevMode'

/** One-line summary of what a widget can do (no tier jargon). */
function accessSummary(e: InstalledExtension): string {
  if (e.hasHost) return 'Can access your computer'
  const parts: string[] = []
  if (e.capabilities.some((c) => c.startsWith('network:'))) parts.push('Network')
  if (e.capabilities.some((c) => c.startsWith('service:'))) parts.push('Account')
  if (e.capabilities.includes('storage') || e.capabilities.includes('secrets')) parts.push('Storage')
  return parts.join(' · ') || 'No special access'
}

/** Settings → Widgets. One list — a widget is a widget; system access surfaces only when you turn
 *  it on. */
export function ManageExtensions(): JSX.Element {
  const [exts, setExts] = useState<InstalledExtension[]>([])
  const [plan, setPlan] = useState<ExtInstallPlan | null>(null)
  const [enabling, setEnabling] = useState<InstalledExtension | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dev, setDev] = useState(false)
  const [market, setMarket] = useState<MarketplaceEntry[]>([])
  const [installing, setInstalling] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setExts(await window.garret.ext.listInstalled())
  }, [])
  const loadMarket = useCallback(async () => {
    try {
      setMarket(await window.garret.ext.marketplace())
    } catch {
      /* offline / no index yet — the marketplace section just stays empty */
    }
  }, [])
  useEffect(() => {
    void refresh()
    void loadMarket()
    void window.garret.store.get<boolean>(DEV_KEY).then((v) => setDev(!!v))
  }, [refresh, loadMarket])

  const installFromMarket = async (m: MarketplaceEntry): Promise<void> => {
    setError(null)
    setInstalling(m.id)
    try {
      const res = await window.garret.ext.installUrl(m.url)
      if (!res.ok) return setError(res.error ?? 'Install failed')
      await resyncExtensions()
      await refresh()
      await loadMarket()
    } finally {
      setInstalling(null)
    }
  }

  const installFrom = async (pick: () => Promise<string | null>, planFn: (p: string) => Promise<ExtInstallPlan>): Promise<void> => {
    setError(null)
    try {
      const src = await pick()
      if (!src) return
      const p = await planFn(src)
      if (!p.ok) return setError(p.error ?? 'Not a valid widget')
      setPlan(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const confirmInstall = async (): Promise<void> => {
    if (!plan) return
    setBusy(true)
    try {
      const res = await window.garret.ext.commitInstall(plan)
      if (plan.staged) void window.garret.ext.cleanupInstall(plan.source)
      setPlan(null)
      if (!res.ok) return setError(res.error ?? 'Install failed')
      await resyncExtensions()
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  const closePlan = (): void => {
    if (plan?.staged) void window.garret.ext.cleanupInstall(plan.source)
    setPlan(null)
  }

  const toggle = async (e: InstalledExtension): Promise<void> => {
    if (e.enabled) {
      await window.garret.ext.setEnabled(e.id, false)
    } else if (needsEnableConsent(e)) {
      setEnabling(e) // system access / account / secrets / open network → confirm first
      return
    } else {
      const res = await window.garret.ext.setEnabled(e.id, true)
      if (!res.ok) return setError(res.error ?? 'Could not enable')
    }
    await resyncExtensions()
    await refresh()
  }
  const confirmEnable = async (): Promise<void> => {
    if (!enabling) return
    setBusy(true)
    const res = await window.garret.ext.setEnabled(enabling.id, true)
    setBusy(false)
    setEnabling(null)
    if (!res.ok) return setError(res.error ?? 'Could not enable')
    await resyncExtensions()
    await refresh()
  }

  const remove = async (e: InstalledExtension): Promise<void> => {
    if (!window.confirm(`Remove “${e.name}”?`)) return
    await window.garret.ext.remove(e.id)
    await resyncExtensions()
    await refresh()
  }

  return (
    <div className="mw">
      <div className="mw-head">
        <h2 className="mw-title">Widgets</h2>
      </div>

      {market.length > 0 && (
        <div className="mw-section">
          <h3 className="mw-subtitle">
            <Store size={13} strokeWidth={1.75} /> Marketplace
          </h3>
          <div className="mw-list">
            {market.map((m) => (
              <div key={m.id} className="mw-card">
                <div className="mw-card-main mw-card-main--static">
                  <span className="mw-card-body">
                    <span className="mw-card-title">
                      {m.name} <span className="mw-ver">v{m.version}</span>
                    </span>
                    {m.description && <span className="mw-card-desc">{m.description}</span>}
                    <span className="mw-card-meta">
                      <span className="mw-cap">{m.publisher}</span>
                      {m.hasHost && <span className="mw-chip mw-chip--danger">Accesses your computer</span>}
                    </span>
                  </span>
                </div>
                <div className="mw-card-actions" onMouseDown={(ev) => ev.stopPropagation()}>
                  {m.installed && m.installedVersion === m.version ? (
                    <span className="mw-chip">Installed</span>
                  ) : (
                    <button
                      className="mw-install"
                      disabled={installing === m.id}
                      onClick={() => void installFromMarket(m)}
                    >
                      {installing === m.id
                        ? m.installed
                          ? 'Updating…'
                          : 'Installing…'
                        : m.installed
                          ? `Update → v${m.version}`
                          : 'Install'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {exts.length === 0 ? (
        <div className="mw-empty">
          <Blocks size={28} strokeWidth={1.5} />
          <p className="mw-empty-title">No widgets yet</p>
          <p className="mw-empty-sub">Add a widget someone shared with you.</p>
        </div>
      ) : (
        <div className="mw-list">
          {exts.map((e) => {
            const broken = e.tampered || !e.integrityOk
            return (
              <div key={e.id} className={`mw-card${e.enabled ? '' : ' mw-card--off'}`}>
                <div className="mw-card-main mw-card-main--static">
                  <span className="mw-card-body">
                    <span className="mw-card-title">
                      {e.name} <span className="mw-ver">v{e.version}</span>
                    </span>
                    {e.description && <span className="mw-card-desc">{e.description}</span>}
                    <span className="mw-card-meta">
                      <span className="mw-cap">{accessSummary(e)}</span>
                      {broken && <span className="mw-chip mw-chip--danger">Integrity failed</span>}
                    </span>
                  </span>
                </div>
                <div className="mw-card-actions" onMouseDown={(ev) => ev.stopPropagation()}>
                  <Toggle on={e.enabled} disabled={broken && !e.enabled} onChange={() => void toggle(e)} />
                  <button className="mw-icon-btn" title="Remove" onClick={() => void remove(e)}>
                    <Trash2 size={15} strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mw-install-row">
        <button
          className="mw-install"
          onClick={() => void installFrom(window.garret.pickGarretFile, window.garret.ext.planInstallFromFile)}
        >
          <HardDriveDownload size={14} strokeWidth={1.75} /> Add widget…
        </button>
        {dev && (
          <button
            className="mw-install mw-install--ghost"
            onClick={() => void installFrom(window.garret.pickDirectory, window.garret.ext.planInstall)}
          >
            <FolderOpen size={14} strokeWidth={1.75} /> Load from folder…
          </button>
        )}
      </div>
      {error && <p className="mw-error">{error}</p>}
      <p className="mw-note">
        <ShieldAlert size={12} strokeWidth={1.9} /> Widgets are unverified. A widget that needs system
        access asks before it turns on.
      </p>

      {plan && <InstallDialog plan={plan} busy={busy} onConfirm={() => void confirmInstall()} onCancel={closePlan} />}
      {enabling && (
        <EnableDialog ext={enabling} busy={busy} onConfirm={() => void confirmEnable()} onCancel={() => setEnabling(null)} />
      )}
    </div>
  )
}

function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: () => void }): JSX.Element {
  return (
    <button
      className={`switch${on ? ' on' : ''}${disabled ? ' switch--disabled' : ''}`}
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
    >
      <span className="switch-knob" />
    </button>
  )
}
