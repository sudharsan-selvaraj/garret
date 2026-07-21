import { useEffect, useMemo, useState } from 'react'
import { Blocks, LayoutGrid, Package, Plus, Search, ShieldAlert } from 'lucide-react'
import type { AnyWidgetPlugin } from '@renderer/plugins/types'
import type { InstalledPack } from '@shared/types/ext'
import { registry } from '@renderer/plugins/registry'
import { useBoardStore } from '@renderer/canvas/useBoardStore'
import { useUiStore } from '@renderer/app/useUiStore'
import { WidgetIcon } from '@renderer/widgets/WidgetIcon'
import { Dialog } from '@renderer/app/Dialog'

interface Group {
  id: string
  name: string
  /** pack icon as a data URL — drives the placeholder for widgets without a preview. */
  icon?: string
  widgets: AnyWidgetPlugin[]
}

/** One group per installed pack — its widgets are registered `gx:<packId>/<widgetId>`. */
function buildGroups(all: AnyWidgetPlugin[], query: string, packs: InstalledPack[]): Group[] {
  const q = query.trim().toLowerCase()
  const matches = (w: AnyWidgetPlugin): boolean =>
    !q ||
    w.manifest.name.toLowerCase().includes(q) ||
    (w.manifest.description?.toLowerCase().includes(q) ?? false)

  const out: Group[] = []
  for (const p of packs) {
    const prefix = `gx:${p.id}/`
    const widgets = all.filter((w) => w.manifest.id.startsWith(prefix) && matches(w))
    if (widgets.length) out.push({ id: `pack:${p.id}`, name: p.name, icon: p.iconData, widgets })
  }
  return out
}

export function AddDialog(): JSX.Element {
  const close = useUiStore((s) => s.close)
  const openSettings = useUiStore((s) => s.openSettings)
  const addWidget = useBoardStore((s) => s.addWidget)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('all')
  const [packs, setPacks] = useState<InstalledPack[]>([])
  useEffect(() => {
    void window.garret.ext.packs().then(setPacks)
  }, [])

  const all = registry.list()
  const navGroups = useMemo(() => buildGroups(all, '', packs), [all, packs]) // categories (unfiltered)
  const filtered = useMemo(() => buildGroups(all, query, packs), [all, query, packs]) // for the right pane
  // Widgets that ship a host (raw Node) — the only install-time risk signal. Everything else is a
  // sandboxed UI, so we don't badge it (no tiers, no "unverified author" theatre).
  const hostIds = useMemo(
    () => new Set(packs.flatMap((p) => p.widgets.filter((w) => w.hasHost).map((w) => `gx:${w.fullId}`))),
    [packs]
  )
  const visible = selected === 'all' ? filtered : filtered.filter((g) => g.id === selected)

  const add = (id: string): void => {
    addWidget(id)
    close()
  }

  return (
    <Dialog title="Add widget" onClose={close} className="dialog-add">
      <div className="add-master">
        <div className="add-nav">
          <div className="add-search">
            <Search size={15} strokeWidth={1.75} />
            <input
              autoFocus
              placeholder="Search widgets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            className={`add-nav-item${selected === 'all' ? ' active' : ''}`}
            onClick={() => setSelected('all')}
          >
            <LayoutGrid size={16} strokeWidth={1.75} />
            <span className="add-nav-name">All Widgets</span>
          </button>
          {navGroups.map((g) => (
            <button
              key={g.id}
              className={`add-nav-item${selected === g.id ? ' active' : ''}`}
              onClick={() => setSelected(g.id)}
            >
              {g.icon ? (
                <img className="add-nav-icon" src={g.icon} alt="" />
              ) : (
                <WidgetIcon icon={Package} size={16} />
              )}
              <span className="add-nav-name">{g.name}</span>
            </button>
          ))}
          <div className="add-nav-spacer" />
          <button className="add-nav-item add-nav-manage" onClick={() => openSettings('widgets')}>
            <Blocks size={16} strokeWidth={1.75} />
            <span className="add-nav-name">Manage widgets…</span>
          </button>
        </div>

        <div className="add-gallery">
          {visible.length === 0 ? (
            <p className="add-list-empty">
              {query ? `No widgets match “${query}”.` : 'No widgets yet — install one from Manage widgets.'}
            </p>
          ) : (
            visible.map((g) => (
              <section className="add-section" key={g.id}>
                <div className="add-section-head">
                  <span>{g.name}</span>
                </div>
                <div className="add-grid">
                  {g.widgets.map((w) => (
                    <WidgetCard
                      key={w.manifest.id}
                      plugin={w}
                      packIcon={g.icon}
                      hasHost={hostIds.has(w.manifest.id)}
                      onAdd={() => add(w.manifest.id)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </Dialog>
  )
}

function WidgetCard({
  plugin,
  packIcon,
  hasHost,
  onAdd
}: {
  plugin: AnyWidgetPlugin
  packIcon?: string
  hasHost: boolean
  onAdd: () => void
}): JSX.Element {
  const { manifest } = plugin
  const size = manifest.defaultSize
  return (
    <div className="add-card">
      <div className="add-card-preview">
        {manifest.preview ? (
          <img className="add-card-shot" src={manifest.preview} alt="" loading="lazy" />
        ) : (
          <div className="add-card-ph">
            {packIcon ? (
              <img className="add-card-ph-icon" src={packIcon} alt="" />
            ) : (
              <WidgetIcon icon={manifest.icon ?? Package} size={30} />
            )}
            <span className="add-card-ph-name">{manifest.name}</span>
          </div>
        )}
        {hasHost && (
          <span
            className="add-card-badge"
            title="This widget runs code on your computer, outside the sandbox."
          >
            <ShieldAlert size={11} strokeWidth={2} /> Host access
          </span>
        )}
      </div>
      <div className="add-card-body">
        <div className="add-card-titles">
          <span className="add-card-name">{manifest.name}</span>
          {manifest.description && <p className="add-card-desc">{manifest.description}</p>}
        </div>
        <div className="add-card-foot">
          {size && (
            <span className="add-card-size" title="Default size">
              {size.w}×{size.h}
            </span>
          )}
          <button className="add-card-btn" onClick={onAdd}>
            <Plus size={14} strokeWidth={2.25} />
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
