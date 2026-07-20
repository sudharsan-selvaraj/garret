import { useCallback, useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Blocks, ChevronLeft, FolderOpen, HardDriveDownload, ShieldAlert, Sparkles, Trash2 } from 'lucide-react'
import type { ExtInstallPlan, InstalledExtension, MarketplaceEntry } from '@shared/types/ext'
import { resyncExtensions } from '@renderer/ext/loader'
import { InstallDialog, EnableDialog, needsEnableConsent } from '@renderer/ext/ExtDialogs'

const DEV_KEY = 'ui.widgetDevMode'

/** One-line summary of what a widget can do (no tier jargon). */
function accessSummary(e: InstalledExtension): string {
  if (e.hasHost) return 'Can access your computer'
  const parts: string[] = []
  if (e.capabilities.some((c) => c.startsWith('network:'))) parts.push('Network')
  if (e.capabilities.includes('secrets') || e.capabilities.includes('storage')) parts.push('Storage')
  if (e.capabilities.includes('openExternal')) parts.push('Links')
  return parts.join(' · ') || 'No special access'
}

/** Pack icon: the real bundled/hosted image if present, else a stable colourful monogram tile. */
function PackIcon({ src, name, size = 40 }: { src?: string; name: string; size?: number }): JSX.Element {
  if (src) {
    return <img className="mw-icon-img" src={src} alt="" style={{ width: size, height: size }} draggable={false} />
  }
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

/** Render trusted-but-sanitized README markdown. No scripts/raw event handlers; links open externally. */
function Readme({ md }: { md: string }): JSX.Element {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(md, { async: false }) as string), [md])
  const onClick = (e: React.MouseEvent): void => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href')
    if (href && /^https?:\/\//i.test(href)) {
      e.preventDefault()
      void window.garret.openExternal(href)
    }
  }
  return <div className="mw-readme" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}

type Selection =
  | { kind: 'installed'; ext: InstalledExtension }
  | { kind: 'market'; entry: MarketplaceEntry }
  | null

/** Settings → Widgets. App-Store layout: a Discover grid + an Installed list, and a details view
 *  (icon · meta · README) you click into. Each pack shows in exactly one place. */
export function ManageExtensions(): JSX.Element {
  const [exts, setExts] = useState<InstalledExtension[]>([])
  const [plan, setPlan] = useState<ExtInstallPlan | null>(null)
  const [enabling, setEnabling] = useState<InstalledExtension | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dev, setDev] = useState(false)
  const [market, setMarket] = useState<MarketplaceEntry[]>([])
  const [installing, setInstalling] = useState<string | null>(null)
  const [selected, setSelected] = useState<Selection>(null)

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
      setEnabling(e)
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
    setSelected(null)
    await resyncExtensions()
    await refresh()
    await loadMarket()
  }

  const discover = market.filter((m) => !m.installed)
  const updateFor = (e: InstalledExtension): MarketplaceEntry | undefined =>
    market.find((m) => m.id === e.id && m.installed && m.installedVersion !== m.version)

  // Keep an open detail view in sync with the latest install/toggle state.
  const liveSelection: Selection = selected
    ? selected.kind === 'installed'
      ? { kind: 'installed', ext: exts.find((e) => e.id === selected.ext.id) ?? selected.ext }
      : selected
    : null

  if (liveSelection) {
    return (
      <PackDetail
        sel={liveSelection}
        installing={installing}
        update={liveSelection.kind === 'installed' ? updateFor(liveSelection.ext) : undefined}
        onBack={() => setSelected(null)}
        onInstall={installFromMarket}
        onToggle={toggle}
        onRemove={remove}
        error={error}
      />
    )
  }

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
              <div
                key={m.id}
                className="mw-tile"
                role="button"
                tabIndex={0}
                onClick={() => setSelected({ kind: 'market', entry: m })}
              >
                <PackIcon src={m.icon} name={m.name} size={44} />
                <div className="mw-tile-body">
                  <span className="mw-tile-name">{m.name}</span>
                  <span className="mw-tile-pub">
                    {m.publisher}
                    {m.hasHost && <span className="mw-chip mw-chip--danger">Accesses your computer</span>}
                  </span>
                  {m.description && <p className="mw-tile-desc">{m.description}</p>}
                </div>
                <span
                  className="mw-get"
                  role="button"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    void installFromMarket(m)
                  }}
                >
                  {installing === m.id ? '…' : 'Get'}
                </span>
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
                <div
                  key={e.id}
                  className={`mw-card${e.enabled ? '' : ' mw-card--off'}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected({ kind: 'installed', ext: e })}
                >
                  <PackIcon src={e.iconData} name={e.name} size={38} />
                  <div className="mw-card-body">
                    <span className="mw-card-title">
                      {e.name} <span className="mw-ver">v{e.version}</span>
                    </span>
                    <span className="mw-card-meta">
                      <span className="mw-cap">{accessSummary(e)}</span>
                      {broken && <span className="mw-chip mw-chip--danger">Integrity failed</span>}
                    </span>
                  </div>
                  <span className="mw-card-actions" onClick={(ev) => ev.stopPropagation()} onMouseDown={(ev) => ev.stopPropagation()}>
                    {upd && (
                      <span
                        className="mw-update"
                        role="button"
                        onClick={() => void installFromMarket(upd)}
                      >
                        {installing === upd.id ? 'Updating…' : `Update → v${upd.version}`}
                      </span>
                    )}
                    <Toggle on={e.enabled} disabled={broken && !e.enabled} onChange={() => void toggle(e)} />
                    <span className="mw-icon-btn" role="button" title="Remove" onClick={() => void remove(e)}>
                      <Trash2 size={15} strokeWidth={1.75} />
                    </span>
                  </span>
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

/* ── Details view (App Store product page) ─────────────────────────────────────────────────────── */

function PackDetail({
  sel,
  update,
  installing,
  onBack,
  onInstall,
  onToggle,
  onRemove,
  error
}: {
  sel: NonNullable<Selection>
  update?: MarketplaceEntry
  installing: string | null
  onBack: () => void
  onInstall: (m: MarketplaceEntry) => void
  onToggle: (e: InstalledExtension) => void
  onRemove: (e: InstalledExtension) => void
  error: string | null
}): JSX.Element {
  const isInstalled = sel.kind === 'installed'
  const name = isInstalled ? sel.ext.name : sel.entry.name
  const publisher = isInstalled ? undefined : sel.entry.publisher
  const version = isInstalled ? sel.ext.version : sel.entry.version
  const iconSrc = isInstalled ? sel.ext.iconData : sel.entry.icon
  const description = isInstalled ? sel.ext.description : sel.entry.description
  const hasHost = isInstalled ? sel.ext.hasHost : sel.entry.hasHost
  const access = isInstalled ? accessSummary(sel.ext) : hasHost ? 'Can access your computer' : undefined

  const [readme, setReadme] = useState<string | null | undefined>(undefined) // undefined = loading
  useEffect(() => {
    let alive = true
    const arg = isInstalled ? { id: sel.ext.id } : sel.entry.readme ? { url: sel.entry.readme } : null
    const has = isInstalled ? sel.ext.hasReadme : !!sel.entry.readme
    if (!arg || !has) {
      setReadme(null)
      return
    }
    setReadme(undefined)
    void window.garret.ext.readme(arg).then((r) => alive && setReadme(r))
    return () => {
      alive = false
    }
  }, [sel, isInstalled])

  return (
    <div className="mw mw-detail">
      <button className="mw-back" onClick={onBack}>
        <ChevronLeft size={16} strokeWidth={2} /> Widgets
      </button>

      <div className="mw-hero">
        <PackIcon src={iconSrc} name={name} size={72} />
        <div className="mw-hero-body">
          <h2 className="mw-hero-name">{name}</h2>
          <div className="mw-hero-meta">
            {publisher && <span>{publisher}</span>}
            <span>v{version}</span>
            {access && <span>{access}</span>}
          </div>
          {description && <p className="mw-hero-desc">{description}</p>}
          {hasHost && (
            <span className="mw-chip mw-chip--danger">
              <ShieldAlert size={11} strokeWidth={2} /> Runs code on your computer
            </span>
          )}
        </div>
        <div className="mw-hero-actions">
          {sel.kind === 'market' ? (
            <button className="mw-install" disabled={installing === sel.entry.id} onClick={() => onInstall(sel.entry)}>
              {installing === sel.entry.id ? 'Installing…' : 'Get'}
            </button>
          ) : (
            <>
              {update && (
                <button className="mw-install" disabled={installing === update.id} onClick={() => onInstall(update)}>
                  {installing === update.id ? 'Updating…' : `Update → v${update.version}`}
                </button>
              )}
              <div className="mw-hero-manage">
                <Toggle on={sel.ext.enabled} onChange={() => onToggle(sel.ext)} />
                <button className="mw-install mw-install--ghost" onClick={() => onRemove(sel.ext)}>
                  <Trash2 size={14} strokeWidth={1.75} /> Remove
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {error && <p className="mw-error">{error}</p>}

      <div className="mw-detail-body">
        {readme === undefined ? (
          <p className="mw-detail-loading">Loading…</p>
        ) : readme ? (
          <Readme md={readme} />
        ) : (
          <p className="mw-detail-loading">{description || 'No description provided.'}</p>
        )}
      </div>
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
