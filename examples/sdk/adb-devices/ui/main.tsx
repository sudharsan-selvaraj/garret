import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { useHost, useHostEvent } from '@garretapp/sdk/react'
import type { Api, Events, AdbDevice, AdbStatus } from '../shared/api'

function App(): JSX.Element {
  const host = useHost<Api, Events>()
  const [devices, setDevices] = useState<AdbDevice[]>([])
  const [status, setStatus] = useState<AdbStatus>({ ok: false, state: 'connecting' })

  // Live — the host pushes on every device change (no polling) + on adb-status changes.
  useHostEvent<Events, 'devices:changed'>('devices:changed', setDevices)
  useHostEvent<Events, 'adb:status'>('adb:status', setStatus)
  // Initial snapshot (covers state that landed before this UI mounted its listeners).
  useEffect(() => {
    void host.status().then(setStatus)
    void host.listDevices().then(setDevices)
  }, [host])

  return (
    <div className="wrap">
      <header>
        <span className="title">Android devices</span>
        {status.ok && <span className="count">{devices.length}</span>}
      </header>

      {!status.ok ? (
        <div className="msg">
          {status.state === 'connecting' ? (
            'Connecting to adb…'
          ) : (
            <>
              <p className="err">{status.error ?? 'adb unavailable'}</p>
              <button onClick={() => void host.retry()}>Retry</button>
            </>
          )}
        </div>
      ) : devices.length === 0 ? (
        <p className="msg">No devices. Connect one over USB and authorize debugging.</p>
      ) : (
        <ul className="list">
          {devices.map((d) => (
            <li key={d.transportId} className="row">
              <span className={`dot ${d.state}`} />
              <span className="name">{d.model || d.product || d.serial}</span>
              <span className="serial">{d.serial}</span>
              <span className="state">{d.state}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
