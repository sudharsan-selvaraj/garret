import { useCallback, useEffect, useState } from 'react'
import { Blocks, ChevronLeft, Database, FolderOpen, Search, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import type { InstallPlan, InstalledWidget } from '@shared/types/sandbox'
import { WidgetIcon } from '@renderer/widgets/WidgetIcon'
import { resyncSandboxedWidgets } from '@renderer/sandbox/loader'
import { ConsentDialog, describePermission, permIcon } from '@renderer/sandbox/ConsentDialog'
import { commitPlan, cancelPlan } from '@renderer/sandbox/installActions'

const DEV_KEY = 'ui.widgetDevMode'

/** One-line capability summary for the card (the full list lives in Details). */
function capSummary(perms: string[]): string {
  if (perms.length === 0) return 'No network or account access'
  const parts: string[] = []
  if (perms.some((p) => p.startsWith('network:'))) parts.push('Network')
  if (perms.some((p) => p.startsWith('service:'))) parts.push('Account data')
  if (perms.includes('files:read')) parts.push('Files')
  if (perms.includes('openExternal')) parts.push('Opens links')
  return parts.join(' · ') || 'Limited access'
}

const nameOf = (w: InstalledWidget): string => String(w.manifest.name ?? w.id)
const descOf = (w: InstalledWidget): string =>
  typeof w.manifest.description === 'string' ? w.manifest.description : ''

/** Settings → Widgets: a Chrome-extensions-style manage surface (install / enable / remove). */
export function ManageWidgets(): JSX.Element {
  const [widgets, setWidgets] = useState<InstalledWidget[]>([])
  const [plan, setPlan] = useState<InstallPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dev, setDev] = useState(false)

  const refresh = useCallback(async () => {
    setWidgets(await window.garret.sandbox.list())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    void window.garret.store.get<boolean>(DEV_KEY).then((v) => setDev(!!v))
  }, [])

  const setDevMode = (v: boolean): void => {
    setDev(v)
    void window.garret.store.set(DEV_KEY, v)
  }

  const startInstall = async (): Promise<void> => {
    setError(null)
    const dir = await window.garret.pickDirectory()
    if (!dir) return
    const p = await window.garret.sandbox.planInstall(dir)
    if (!p.ok) return setError(p.error ?? 'Not a valid widget folder')
    setPlan(p)
  }
  const startFileInstall = async (): Promise<void> => {
    setError(null)
    const file = await window.garret.pickGarretFile()
    if (!file) return
    const p = await window.garret.sandbox.installFromFile(file)
    if (!p.ok) return setError(p.error ?? 'Not a valid .garret file')
    setPlan(p)
  }
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
    setSelectedId(null)
    await refresh()
  }
  const toggle = async (w: InstalledWidget): Promise<void> => {
    await window.garret.sandbox.setEnabled(w.id, !w.enabled)
    await resyncSandboxedWidgets()
    await refresh()
  }

  const selected = selectedId ? widgets.find((w) => w.id === selectedId) : undefined
  const consent = plan && (
    <ConsentDialog
      plan={plan}
      busy={busy}
      onConfirm={() => void confirmInstall()}
      onCancel={() => closePlan(plan)}
    />
  )

  // ---- Details sub-view -------------------------------------------------
  if (selected) {
    return (
      <div className="mw">
        <WidgetDetails
          w={selected}
          onBack={() => setSelectedId(null)}
          onToggle={() => void toggle(selected)}
          onRemove={() => void remove(selected.id, nameOf(selected))}
        />
        {consent}
      </div>
    )
  }

  // ---- List view --------------------------------------------------------
  const q = query.trim().toLowerCase()
  const shown = q
    ? widgets.filter((w) => nameOf(w).toLowerCase().includes(q) || descOf(w).toLowerCase().includes(q))
    : widgets

  return (
    <div className="mw">
      <div className="mw-head">
        <h2 className="mw-title">Widgets</h2>
        <div className="mw-search">
          <Search size={14} strokeWidth={1.75} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search widgets"
            spellCheck={false}
          />
        </div>
        <label className="mw-dev">
          <span>Developer mode</span>
          <ExtToggle on={dev} onChange={setDevMode} />
        </label>
      </div>

      {widgets.length === 0 ? (
        <div className="mw-empty">
          <Blocks size={28} strokeWidth={1.5} />
          <p className="mw-empty-title">No widgets installed</p>
          <p className="mw-empty-sub">
            Install a <code>.garret</code> file someone shared, or build your own.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="mw-empty">
          <p className="mw-empty-sub">No widgets match “{query}”.</p>
        </div>
      ) : (
        <div className="mw-list">
          {shown.map((w) => (
            <WidgetCard
              key={w.id}
              w={w}
              onOpen={() => setSelectedId(w.id)}
              onToggle={() => void toggle(w)}
              onRemove={() => void remove(w.id, nameOf(w))}
            />
          ))}
        </div>
      )}

      <div className="mw-install-row">
        <button className="mw-install" onClick={() => void startFileInstall()}>
          <Blocks size={14} strokeWidth={1.75} /> Install widget…
        </button>
        {dev && (
          <button className="mw-install mw-install--ghost" onClick={() => void startInstall()}>
            <FolderOpen size={14} strokeWidth={1.75} /> Load from folder…
          </button>
        )}
      </div>
      {error && <p className="mw-error">{error}</p>}
      <p className="mw-note">
        Third-party widgets run sandboxed and isolated — they only get the access you approve at
        install. Authors are unverified; only install widgets you trust.
      </p>

      {consent}
    </div>
  )
}

function WidgetCard({
  w,
  onOpen,
  onToggle,
  onRemove
}: {
  w: InstalledWidget
  onOpen: () => void
  onToggle: () => void
  onRemove: () => void
}): JSX.Element {
  const name = nameOf(w)
  const desc = descOf(w)
  return (
    <div className={`mw-card${w.enabled ? '' : ' mw-card--off'}`}>
      <button className="mw-card-main" onClick={onOpen}>
        <span className="mw-card-icon">
          {w.manifest.icon ? <WidgetIcon icon={w.manifest.icon as never} size={22} /> : <Blocks size={20} strokeWidth={1.6} />}
        </span>
        <span className="mw-card-body">
          <span className="mw-card-title">
            {name} <span className="mw-ver">v{w.version}</span>
          </span>
          {desc && <span className="mw-card-desc">{desc}</span>}
          <span className="mw-card-meta">
            <span className="mw-cap">{capSummary(w.consentedPermissions)}</span>
            {w.tampered && <span className="mw-chip mw-chip--danger">Integrity failed</span>}
            {!w.tampered && w.attemptedBlocked.length > 0 && (
              <span className="mw-chip mw-chip--warn">Blocked attempts</span>
            )}
          </span>
        </span>
      </button>
      <div className="mw-card-actions" onMouseDown={(e) => e.stopPropagation()}>
        <ExtToggle on={w.enabled} onChange={onToggle} />
        <button className="mw-icon-btn" title="Remove" onClick={onRemove}>
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

function WidgetDetails({
  w,
  onBack,
  onToggle,
  onRemove
}: {
  w: InstalledWidget
  onBack: () => void
  onToggle: () => void
  onRemove: () => void
}): JSX.Element {
  const cap = (p: string): JSX.Element => {
    const Icon = permIcon(p)
    return (
      <li key={p} className="mw-perm">
        <Icon size={15} strokeWidth={1.75} />
        <span>{describePermission(p)}</span>
      </li>
    )
  }
  return (
    <div className="mw-detail">
      <div className="mw-detail-head">
        <button className="mw-back" onClick={onBack} title="Back">
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <span className="mw-card-icon">
          {w.manifest.icon ? <WidgetIcon icon={w.manifest.icon as never} size={24} /> : <Blocks size={22} strokeWidth={1.6} />}
        </span>
        <div className="mw-detail-titles">
          <h2>{nameOf(w)}</h2>
          <span className="mw-ver">v{w.version}</span>
        </div>
        <div className="mw-detail-enable">
          <span>{w.enabled ? 'Enabled' : 'Disabled'}</span>
          <ExtToggle on={w.enabled} onChange={onToggle} />
        </div>
      </div>

      {descOf(w) && <p className="mw-detail-desc">{descOf(w)}</p>}

      {w.tampered && (
        <div className="mw-banner mw-banner--danger">
          <ShieldAlert size={15} strokeWidth={1.9} /> Integrity check failed — reinstall this widget.
        </div>
      )}

      <p className="mw-detail-h">This widget can</p>
      <ul className="mw-perms">
        {w.consentedPermissions.map(cap)}
        <li className="mw-perm mw-perm--muted">
          <Database size={15} strokeWidth={1.75} />
          <span>Store its own settings (isolated to this widget)</span>
        </li>
        {w.consentedPermissions.length === 0 && (
          <li className="mw-perm mw-perm--muted">
            <ShieldCheck size={15} strokeWidth={1.75} />
            <span>Nothing else — no network or account access</span>
          </li>
        )}
      </ul>

      {w.attemptedBlocked.length > 0 && (
        <>
          <p className="mw-detail-h">Tried (blocked)</p>
          <ul className="mw-perms">
            {w.attemptedBlocked.map((p) => (
              <li key={p} className="mw-perm mw-perm--warn">
                <ShieldAlert size={15} strokeWidth={1.75} />
                <span>{describePermission(p)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mw-detail-foot">
        <span className="mw-integrity">
          {w.tampered ? (
            <>
              <ShieldAlert size={13} strokeWidth={2} /> Integrity check failed
            </>
          ) : (
            <>
              <ShieldCheck size={13} strokeWidth={2} /> Verified · runs sandboxed
            </>
          )}
        </span>
        <button className="mw-remove" onClick={onRemove}>
          <Trash2 size={14} strokeWidth={1.75} /> Remove widget
        </button>
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
