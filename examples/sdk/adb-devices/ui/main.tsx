import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useState } from 'react'
import { useHost } from '@garretapp/sdk/react'
import type { Api, AdbDevice } from '../shared/api'

function App(): JSX.Element {
  const host = useHost<Api>()
  const [devices, setDevices] = useState<AdbDevice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDevices(await host.listDevices())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [host])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="wrap">
      <header>
        <span className="title">Android devices</span>
        <button onClick={() => void refresh()} disabled={loading}>
          {loading ? '…' : 'Refresh'}
        </button>
      </header>

      {error ? (
        <p className="msg err">adb server unreachable — {error}</p>
      ) : devices === null ? (
        <p className="msg">Loading…</p>
      ) : devices.length === 0 ? (
        <p className="msg">No devices. Connect one over USB and enable USB debugging.</p>
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
