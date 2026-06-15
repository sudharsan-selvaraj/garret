import type { AnyWidgetPlugin, ServiceDefinition } from '@sdk'
import { useServiceStatus } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import { serviceRegistry } from '@renderer/services/serviceRegistry'
import { useBoardStore } from '@renderer/canvas/useBoardStore'
import { useUiStore } from '@renderer/app/useUiStore'
import { WidgetIcon } from '@renderer/widgets/WidgetIcon'
import { Dialog } from '@renderer/app/Dialog'

export function AddDialog(): JSX.Element {
  const close = useUiStore((s) => s.close)
  const openSettings = useUiStore((s) => s.openSettings)
  const addWidget = useBoardStore((s) => s.addWidget)

  const all = registry.list()
  const add = (id: string): void => {
    addWidget(id)
    close()
  }

  const general = all.filter((w) => !w.manifest.serviceId)

  return (
    <Dialog title="Add widget" onClose={close} className="dialog-add">
      {serviceRegistry.list().map((def) => {
        const widgets = all.filter((w) => w.manifest.serviceId === def.id)
        if (widgets.length === 0) return null
        return (
          <ServiceGroup
            key={def.id}
            def={def}
            widgets={widgets}
            onAdd={add}
            onConnect={() => openSettings(def.id)}
          />
        )
      })}
      {general.length > 0 && (
        <section className="add-group">
          <header className="add-group-head">
            <span className="add-group-name">General</span>
          </header>
          <div className="add-grid">
            {general.map((w) => (
              <WidgetCard key={w.manifest.id} plugin={w} onClick={() => add(w.manifest.id)} />
            ))}
          </div>
        </section>
      )}
    </Dialog>
  )
}

function ServiceGroup({
  def,
  widgets,
  onAdd,
  onConnect
}: {
  def: ServiceDefinition
  widgets: AnyWidgetPlugin[]
  onAdd: (id: string) => void
  onConnect: () => void
}): JSX.Element {
  const { status } = useServiceStatus(def.id)
  const locked = def.requiresConnection && !status?.connected

  return (
    <section className="add-group">
      <header className="add-group-head">
        <WidgetIcon icon={def.icon} size={16} />
        <span className="add-group-name">{def.name}</span>
        {locked ? (
          <button className="add-connect" onClick={onConnect}>
            Connect to add
          </button>
        ) : (
          <span className="add-group-ok">Connected</span>
        )}
      </header>
      <div className="add-grid">
        {widgets.map((w) => (
          <WidgetCard
            key={w.manifest.id}
            plugin={w}
            disabled={locked}
            onClick={() => (locked ? onConnect() : onAdd(w.manifest.id))}
          />
        ))}
      </div>
    </section>
  )
}

function WidgetCard({
  plugin,
  onClick,
  disabled
}: {
  plugin: AnyWidgetPlugin
  onClick: () => void
  disabled?: boolean
}): JSX.Element {
  const { manifest } = plugin
  return (
    <button className={`widget-card${disabled ? ' disabled' : ''}`} onClick={onClick}>
      <span className="widget-card-icon">
        <WidgetIcon icon={manifest.icon} size={20} />
      </span>
      <span className="widget-card-name">{manifest.name}</span>
      {manifest.description && <span className="widget-card-desc">{manifest.description}</span>}
    </button>
  )
}
