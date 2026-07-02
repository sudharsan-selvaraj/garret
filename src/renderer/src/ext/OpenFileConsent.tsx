import { useEffect, useState } from 'react'
import type { ExtInstallPlan } from '@shared/types/ext'
import { InstallDialog } from '@renderer/ext/ExtDialogs'
import { resyncExtensions } from '@renderer/ext/loader'

/**
 * Listens for a `.garret` opened from Finder (double-click / Open With) and pops the install
 * dialog over the board, reusing the exact same pipeline as Settings → Widgets. Mounted once at
 * the app root so it works whether or not Settings is open.
 */
export function OpenFileConsent(): JSX.Element | null {
  const [plan, setPlan] = useState<ExtInstallPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const off = window.garret.ext.onOpenFile(async (path) => {
      setError(null)
      try {
        const p = await window.garret.ext.planInstallFromFile(path)
        if (!p.ok) return setError(p.error ?? 'Not a valid .garret file')
        setPlan(p)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
    // Drain any .garret opened before this listener mounted (cold launch via double-click).
    window.garret.ext.flushOpenFiles()
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
    try {
      const res = await window.garret.ext.commitInstall(plan)
      if (plan.staged) void window.garret.ext.cleanupInstall(plan.source)
      setPlan(null)
      if (!res.ok) return setError(res.error ?? 'Install failed')
      await resyncExtensions()
    } finally {
      setBusy(false)
    }
  }
  const cancel = (): void => {
    if (plan.staged) void window.garret.ext.cleanupInstall(plan.source)
    setPlan(null)
  }

  return <InstallDialog plan={plan} busy={busy} onConfirm={() => void confirm()} onCancel={cancel} />
}
