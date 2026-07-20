import { useCallback, useEffect, useState } from 'react'
import { Blocks, FolderOpen, HardDriveDownload, ShieldAlert, Sparkles, Trash2 } from 'lucide-react'
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

/** A colourful rounded app-icon tile (monogram) derived from the pack name — packs don't ship icons,
 *  so we generate a stable, distinct tile per pack (App Store-ish). */
function PackTile({ name, size = 40 }: { name: string; size?: number }): JSX.Element {
  const ch = (name.trim()[0] || '?').toUpperCase()
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360
  return (
    <span
      className="mw-mono"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.44,
        background: `linear-gradient(140deg, hsl(${hue} 62% 54%), hsl(${(hue + 42) % 360} 58% 42%))`
      }}
    >
      {ch}
    </span>
  )
}

/** Settings → Widgets. App-Store layout: a Discover grid of installable packs + an Installed list
 *  you manage. Each pack shows in exactly one place. */
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
      /* offline / no index yet — Discover just stays hidden */
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
      await loadMarket()
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
    await loadMarket()
  }

  // Discover = registry packs you don't have. Updates fold into the installed card.
  const discover = market.filter((m) => !m.installed)
  const updateFor = (e: InstalledExtension): MarketplaceEntry | undefined =>
    market.find((m) => m.id === e.id && m.installed && m.installedVersion !== m.version)

  return (
    <div className="mw">
      <div className="mw-head">
        <h2 className="mw-title">Widgets</h2>
      </div>

      {discover.length > 0 && (
        <section className="mw-section">
          <h3 className="mw-subtitle">
            <Sparkles size={13} strokeWidth={1.75} /> Discover
          </h3>
          <div className="mw-grid">
            {discover.map((m) => (
              <div key={m.id} className="mw-tile">
                <PackTile name={m.name} size={44} />
                <div className="mw-tile-body">
                  <span className="mw-tile-name">{m.name}</span>
                  <span className="mw-tile-pub">
                    {m.publisher}
                    {m.hasHost && <span className="mw-chip mw-chip--danger">Accesses your computer</span>}
                  </span>
                  {m.description && <p className="mw-tile-desc">{m.description}</p>}
                </div>
                <button
                  className="mw-get"
                  disabled={installing === m.id}
                  onClick={() => void installFromMarket(m)}
                >
                  {installing === m.id ? '…' : 'Get'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mw-section">
        <h3 className="mw-subtitle">
          <Blocks size={13} strokeWidth={1.75} /> Installed
        </h3>
        {exts.length === 0 ? (
          <div className="mw-empty">
            <Blocks size={28} strokeWidth={1.5} />
            <p className="mw-empty-title">No widgets installed</p>
            <p className="mw-empty-sub">Install one from Discover, or add a widget someone shared.</p>
          </div>
        ) : (
          <div className="mw-list">
            {exts.map((e) => {
              const broken = e.tampered || !e.integrityOk
              const upd = updateFor(e)
              return (
                <div key={e.id} className={`mw-card${e.enabled ? '' : ' mw-card--off'}`}>
                  <PackTile name={e.name} size={38} />
                  <div className="mw-card-body">
                    <span className="mw-card-title">
                      {e.name} <span className="mw-ver">v{e.version}</span>
                    </span>
                    <span className="mw-card-meta">
                      <span className="mw-cap">{accessSummary(e)}</span>
                      {broken && <span className="mw-chip mw-chip--danger">Integrity failed</span>}
                    </span>
                  </div>
                  <div className="mw-card-actions" onMouseDown={(ev) => ev.stopPropagation()}>
                    {upd && (
                      <button
                        className="mw-update"
                        disabled={installing === upd.id}
                        onClick={() => void installFromMarket(upd)}
                      >
                        {installing === upd.id ? 'Updating…' : `Update → v${upd.version}`}
                      </button>
                    )}
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
      </section>

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
