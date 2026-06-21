import { useEffect, useState } from 'react'
import type { InstallPlan } from '@shared/types/sandbox'
import { ConsentDialog } from '@renderer/sandbox/ConsentDialog'
import { commitPlan, cancelPlan } from '@renderer/sandbox/installActions'

/**
 * Listens for a `.garret` opened from Finder (double-click / Open With) and pops the consent
 * dialog over the board, reusing the exact same install pipeline as the Settings pane. Mounted
 * once at the app root so it works whether or not Settings is open.
 */
export function GarretOpenFileConsent(): JSX.Element | null {
  const [plan, setPlan] = useState<InstallPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const off = window.garret.sandbox.onOpenFile(async (path) => {
      setError(null)
      const p = await window.garret.sandbox.installFromFile(path)
      if (!p.ok) {
        setError(p.error ?? 'Not a valid .garret file')
        return
      }
      setPlan(p)
    })
    // Drain any .garret opened before this listener mounted (cold launch via double-click).
    window.garret.sandbox.flushOpenFiles()
    return off
  }, [])

  if (!plan) {
    if (!error) return null
    return (
      <div className="consent-backdrop" onClick={() => setError(null)}>
        <div className="consent-card" onClick={(e) => e.stopPropagation()}>
          <p className="consent-h">Couldn’t open that .garret</p>
          <div className="consent-source">{error}</div>
          <div className="consent-actions">
            <button className="consent-install" onClick={() => setError(null)}>
              OK
            </button>
          </div>
        </div>
      </div>
    )
  }

  const confirm = async (): Promise<void> => {
    setBusy(true)
    const res = await commitPlan(plan)
    setBusy(false)
    setPlan(null)
    if (!res.ok) setError(res.error ?? 'Install failed')
  }
  const cancel = (): void => {
    cancelPlan(plan)
    setPlan(null)
  }

  return <ConsentDialog plan={plan} busy={busy} onConfirm={() => void confirm()} onCancel={cancel} />
}
