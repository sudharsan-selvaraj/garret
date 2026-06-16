import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { services, useServiceStatus, type ServiceDefinition } from '@sdk'
import { serviceRegistry } from '@renderer/services/serviceRegistry'
import { useUiStore } from '@renderer/app/useUiStore'
import { WidgetIcon } from '@renderer/widgets/WidgetIcon'
import { Dialog } from '@renderer/app/Dialog'
import { GeneralSettings } from '@renderer/app/GeneralSettings'

const GENERAL = 'general'

export function SettingsDialog(): JSX.Element {
  const close = useUiStore((s) => s.close)
  const initial = useUiStore((s) => s.settingsServiceId)
  const defs = serviceRegistry.list()
  const [selected, setSelected] = useState<string>(initial ?? GENERAL)

  return (
    <Dialog title="Settings" onClose={close} className="dialog-settings">
      <div className="settings-master">
        <ul className="settings-services">
          <li>
            <button
              className={`svc-nav${selected === GENERAL ? ' active' : ''}`}
              onClick={() => setSelected(GENERAL)}
            >
              <SlidersHorizontal size={16} strokeWidth={1.75} />
              <span className="svc-nav-name">General</span>
            </button>
          </li>
          <li className="settings-nav-sep" />
          {defs.map((d) => (
            <li key={d.id}>
              <button
                className={`svc-nav${selected === d.id ? ' active' : ''}`}
                onClick={() => setSelected(d.id)}
              >
                <WidgetIcon icon={d.icon} size={17} />
                <span className="svc-nav-name">{d.name}</span>
                <ServiceBadge id={d.id} />
              </button>
            </li>
          ))}
        </ul>
        <div className="settings-detail">
          {selected === GENERAL ? (
            <GeneralSettings />
          ) : (
            <ServiceDetail def={defs.find((d) => d.id === selected) as ServiceDefinition} />
          )}
        </div>
      </div>
    </Dialog>
  )
}

function ServiceBadge({ id }: { id: string }): JSX.Element {
  const { status } = useServiceStatus(id)
  return <span className={`svc-badge${status?.connected ? ' on' : ''}`} />
}

function ServiceDetail({ def }: { def: ServiceDefinition }): JSX.Element {
  const { status, setStatus } = useServiceStatus(def.id)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const connected = status?.connected === true

  const connect = async (): Promise<void> => {
    setBusy(true)
    setStatus(await services.connect(def.id, values))
    setBusy(false)
  }
  const disconnect = async (): Promise<void> => {
    setStatus(await services.disconnect(def.id))
    setValues({})
  }

  return (
    <div className="svc-detail" key={def.id}>
      <div className="svc-detail-head">
        <WidgetIcon icon={def.icon} size={22} />
        <div>
          <h3>{def.name}</h3>
          {def.description && <p>{def.description}</p>}
        </div>
      </div>

      {connected ? (
        <div className="svc-connected">
          <span>
            Connected as <b>{status?.account}</b>
          </span>
          <button className="svc-btn" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <div className="settings-group">
            {Object.entries(def.connectionSchema).map(([key, f]) => (
              <div className="settings-row" key={key}>
                <label className="settings-row-label">{f.label}</label>
                <div className="settings-row-control">
                  <input
                    className="row-input"
                    type={f.type === 'password' ? 'password' : 'text'}
                    placeholder={f.placeholder}
                    value={values[key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  />
                </div>
              </div>
            ))}
          </div>
          {status?.error && <p className="svc-error">{status.error}</p>}
          <button className="settings-done" onClick={connect} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </>
      )}
    </div>
  )
}
