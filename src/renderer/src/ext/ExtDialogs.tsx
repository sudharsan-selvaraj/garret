import { useState } from 'react'
import { ShieldAlert, TriangleAlert } from 'lucide-react'
import type { ExtInstallPlan, InstalledExtension } from '@shared/types/ext'

/** Plain-language description of a capability (no jargon, no tier labels). */
function describe(cap: string): string {
  if (cap === 'storage') return 'Store its own data'
  if (cap === 'secrets') return 'Store secrets, encrypted'
  if (cap.startsWith('network:')) return `Connect to ${cap.slice(8)}`
  if (cap.startsWith('service:')) return `Use your ${cap.slice(8)} account`
  if (cap === 'notify') return 'Show notifications'
  if (cap === 'clipboard') return 'Read and write the clipboard'
  if (cap === 'openExternal') return 'Open links'
  if (cap === 'process') return 'Run programs on your Mac'
  if (cap === 'fs') return 'Read and write your files'
  if (cap === 'native') return 'Full access to your Mac'
  return cap
}

const ENABLE_PHRASE = 'I trust this'

/** Install confirmation. One dialog; the copy scales with what the widget can do. Full-access
 *  widgets get the plain warning + install disabled (the enable step is the real gate). */
export function InstallDialog({
  plan,
  busy,
  onConfirm,
  onCancel
}: {
  plan: ExtInstallPlan
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <div className="consent-backdrop" onClick={onCancel}>
      <div className="consent-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="consent-title">
          {plan.isUpdate ? 'Update' : 'Add'} “{plan.name}”?
        </h3>
        <div className="consent-source" title={plan.source}>
          v{plan.version}
        </div>

        {plan.capabilities.length > 0 && (
          <>
            <p className="consent-h">This widget can</p>
            <ul className="consent-caps">
              {plan.capabilities.map((c) => (
                <li key={c} className="consent-cap">
                  {describe(c)}
                </li>
              ))}
            </ul>
          </>
        )}
        {plan.hasHost && (
          <p className="consent-note">
            <ShieldAlert size={13} strokeWidth={2} /> This widget can access your computer — files,
            network, and programs. Only add widgets you trust.
          </p>
        )}

        <div className="consent-actions">
          <button className="consent-cancel" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="consent-install" onClick={onConfirm} disabled={busy}>
            {busy ? 'Adding…' : plan.isUpdate ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** True when turning a widget on grants access worth confirming (system access, an account, secrets,
 *  or unrestricted network). Plain network:<host> + storage stay one-click (disclosed at install). */
export function needsEnableConsent(e: InstalledExtension): boolean {
  // No consent model any more — install/enable is one-click; the host warning shows at install.
  void e
  return false
}

/** Enable consent, scaled to what the widget can do: full system access requires typing a phrase;
 *  other sensitive access (account/secrets/open network) is a plain confirm. */
export function EnableDialog({
  ext,
  busy,
  onConfirm,
  onCancel
}: {
  ext: InstalledExtension
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const requirePhrase = ext.hasHost
  const [typed, setTyped] = useState('')
  const armed = !requirePhrase || typed.trim().toLowerCase() === ENABLE_PHRASE.toLowerCase()
  return (
    <div className="consent-backdrop" onClick={onCancel}>
      <div className="consent-card" onClick={(e) => e.stopPropagation()}>
        <div className="consent-head">
          <span className={`consent-icon${requirePhrase ? ' consent-icon--danger' : ''}`}>
            <TriangleAlert size={20} strokeWidth={1.75} />
          </span>
          <div className="consent-head-text">
            <h3 className="consent-title">Turn on “{ext.name}”?</h3>
            <div className="consent-source">v{ext.version}</div>
          </div>
        </div>
        {requirePhrase ? (
          <p className="consent-danger-lede">
            <strong>{ext.name}</strong> runs with <strong>full access to your Mac</strong> — it can read
            and change files, run programs, and use the network. Only turn on widgets you trust.
          </p>
        ) : (
          <>
            <p className="consent-h">This widget will</p>
            <ul className="consent-caps">
              {ext.capabilities.map((c) => (
                <li key={c} className="consent-cap">
                  {describe(c)}
                </li>
              ))}
            </ul>
          </>
        )}
        {requirePhrase && (
          <label className="consent-typebox">
            <span>
              To turn on, type <code>{ENABLE_PHRASE}</code>
            </span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus spellCheck={false} autoComplete="off" />
          </label>
        )}
        <div className="consent-actions">
          <button className="consent-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`consent-install${requirePhrase ? ' consent-install--danger' : ''}`}
            onClick={onConfirm}
            disabled={busy || !armed}
          >
            {busy ? 'Turning on…' : 'Turn on'}
          </button>
        </div>
      </div>
    </div>
  )
}
