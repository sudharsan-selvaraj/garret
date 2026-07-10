import { useEffect, useMemo, useState } from 'react'
import { Blocks, LayoutGrid, Package, Plus, Search, ShieldAlert } from 'lucide-react'
import type { AnyWidgetPlugin } from '@sdk'
import { useServiceStatus } from '@sdk'
import type { InstalledPack } from '@shared/types/ext'
import { registry } from '@renderer/plugins/registry'
import { serviceRegistry } from '@renderer/services/serviceRegistry'
import { useBoardStore } from '@renderer/canvas/useBoardStore'
import { useUiStore } from '@renderer/app/useUiStore'
import { WidgetIcon } from '@renderer/widgets/WidgetIcon'
import { WidgetPreview } from '@renderer/app/widgetPreviews'
import { Dialog } from '@renderer/app/Dialog'

interface Group {
  id: string
  name: string
  icon?: AnyWidgetPlugin['manifest']['icon']
  serviceId?: string
  widgets: AnyWidgetPlugin[]
}

/** Dev-tier external widgets are namespaced `ext:` by the registry. Everything without a known
 *  third-party prefix is a first-party built-in. */
function isThirdParty(w: AnyWidgetPlugin): boolean {
  return w.manifest.id.startsWith('ext:')
}

/** Unified installed widgets (`gx:`) — a widget is a widget; web/native is not a user-facing
 *  category. */
function isExtWidget(w: AnyWidgetPlugin): boolean {
  return w.manifest.id.startsWith('gx:')
}

function buildGroups(all: AnyWidgetPlugin[], query: string, packs: InstalledPack[]): Group[] {
  const q = query.trim().toLowerCase()
  const matches = (w: AnyWidgetPlugin): boolean =>
    !q ||
    w.manifest.name.toLowerCase().includes(q) ||
    (w.manifest.description?.toLowerCase().includes(q) ?? false)

  const out: Group[] = []
  for (const def of serviceRegistry.list()) {
    const widgets = all.filter((w) => w.manifest.serviceId === def.id && !isThirdParty(w) && matches(w))
    if (widgets.length) out.push({ id: def.id, name: def.name, icon: def.icon, serviceId: def.id, widgets })
  }
  // One group PER installed pack — its widgets are registered `gx:<packId>/<widgetId>`.
  for (const p of packs) {
    const prefix = `gx:${p.id}/`
    const widgets = all.filter((w) => w.manifest.id.startsWith(prefix) && matches(w))
    if (widgets.length) out.push({ id: `pack:${p.id}`, name: p.name, icon: Package, widgets })
  }
  // Dev-tier (`ext:`) widgets loaded from disk.
  const dev = all.filter((w) => isThirdParty(w) && matches(w))
  if (dev.length) out.push({ id: 'dev', name: 'Dev widgets', icon: Blocks, widgets: dev })
  // Built-in miscellaneous (first-party, no service) — until they're migrated to packs.
  const general = all.filter((w) => !w.manifest.serviceId && !isThirdParty(w) && !isExtWidget(w) && matches(w))
  if (general.length) out.push({ id: 'general', name: 'General', widgets: general })
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
    () =>
      new Set(
        packs.flatMap((p) => p.widgets.filter((w) => w.hasHost).map((w) => `gx:${w.fullId}`))
      ),
    [packs]
  )
  const visible = selected === 'all' ? filtered : filtered.filter((g) => g.id === selected)

  const add = (id: string): void => {
    addWidget(id)
    close()
  }
  const connect = (serviceId: string): void => openSettings(serviceId)

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
              <WidgetIcon icon={g.icon} size={16} />
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
              {query ? `No widgets match “${query}”.` : 'No widgets here.'}
            </p>
          ) : (
            visible.map((g) =>
              g.serviceId ? (
                <ServiceSection key={g.id} group={g} onAdd={add} onConnect={connect} hostIds={hostIds} />
              ) : (
                <GeneralSection key={g.id} group={g} onAdd={add} hostIds={hostIds} />
              )
            )
          )}
        </div>
      </div>
    </Dialog>
  )
}

function GeneralSection({
  group,
  onAdd,
  hostIds
}: {
  group: Group
  onAdd: (id: string) => void
  hostIds: Set<string>
}): JSX.Element {
  return (
    <section className="add-section">
      <div className="add-section-head">
        <span>{group.name}</span>
      </div>
      {group.widgets.map((w) => (
        <WidgetItem
          key={w.manifest.id}
          plugin={w}
          locked={false}
          hasHost={hostIds.has(w.manifest.id)}
          onAdd={() => onAdd(w.manifest.id)}
        />
      ))}
    </section>
  )
}

function ServiceSection({
  group,
  onAdd,
  onConnect,
  hostIds
}: {
  group: Group
  onAdd: (id: string) => void
  onConnect: (serviceId: string) => void
  hostIds: Set<string>
}): JSX.Element {
  const { status } = useServiceStatus(group.serviceId as string)
  const def = serviceRegistry.get(group.serviceId as string)
  const locked = (def?.requiresConnection ?? false) && !status?.connected

  return (
    <section className="add-section">
      <div className="add-section-head">
        <span>{group.name}</span>
        {locked ? (
          <button className="add-section-connect" onClick={() => onConnect(group.serviceId as string)}>
            Connect
          </button>
        ) : (
          <span className="add-section-ok">● Connected</span>
        )}
      </div>
      {group.widgets.map((w) => (
        <WidgetItem
          key={w.manifest.id}
          plugin={w}
          locked={locked}
          hasHost={hostIds.has(w.manifest.id)}
          onAdd={() => onAdd(w.manifest.id)}
          onConnect={() => onConnect(group.serviceId as string)}
        />
      ))}
    </section>
  )
}

function WidgetItem({
  plugin,
  locked,
  hasHost,
  onAdd,
  onConnect
}: {
  plugin: AnyWidgetPlugin
  locked: boolean
  hasHost: boolean
  onAdd: () => void
  onConnect?: () => void
}): JSX.Element {
  const { manifest } = plugin
  return (
    <div className="add-item">
      <div className="add-item-bar">
        <div className="add-item-titles">
          <div className="add-item-head">
            <WidgetIcon icon={manifest.icon} size={16} />
            <span className="add-item-name">{manifest.name}</span>
            {hasHost && (
              <span className="add-item-badge" title="This widget runs code on your computer, outside the sandbox.">
                <ShieldAlert size={11} strokeWidth={2} /> Host access
              </span>
            )}
          </div>
          {manifest.description && <p className="add-item-desc">{manifest.description}</p>}
        </div>
        {locked ? (
          <button className="add-item-btn add-item-btn--connect" onClick={onConnect}>
            Connect to add
          </button>
        ) : (
          <button className="add-item-btn" onClick={onAdd}>
            <Plus size={14} strokeWidth={2.25} />
            Add
          </button>
        )}
      </div>
      <WidgetPreview plugin={plugin} />
    </div>
  )
}
