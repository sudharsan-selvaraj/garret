import { useState } from 'react'
import { HardDriveDownload, ShieldAlert, TriangleAlert } from 'lucide-react'
import type { NativeInstallPlan, InstalledExtension } from '@shared/types/native'

/** The exact phrase the user must type to enable a full-access extension (NOT shown pre-filled). */
const ENABLE_PHRASE = 'I trust this'

function declaredSummary(d: { binaries: string[]; network: string[] }): string {
  const parts: string[] = []
  if (d.binaries.length) parts.push(`runs ${d.binaries.join(', ')}`)
  if (d.network.length) parts.push(`network ${d.network.join(', ')}`)
  return parts.length ? parts.join(' · ') : 'no binaries or network declared'
}

/**
 * Install confirmation for a native extension. Deliberately NOT scary: installing writes files but
 * runs nothing (the extension lands disabled). The full-access decision happens at enable time
 * (see {@link NativeEnableDialog}).
 */
export function NativeInstallDialog({
  plan,
  busy,
  onConfirm,
  onCancel
}: {
  plan: NativeInstallPlan
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <div className="consent-backdrop" onClick={onCancel}>
      <div className="consent-card" onClick={(e) => e.stopPropagation()}>
        <div className="consent-head">
          <span className="consent-icon">
            <HardDriveDownload size={22} strokeWidth={1.75} />
          </span>
          <div className="consent-head-text">
            <h3 className="consent-title">
              {plan.isUpdate ? 'Update' : 'Install'} “{plan.name}”?
            </h3>
            <div className="consent-source" title={plan.source}>
              v{plan.version} · {plan.source}
            </div>
          </div>
        </div>

        <div className="consent-badge consent-badge--danger">
          <ShieldAlert size={13} strokeWidth={2} /> Native extension · full system access
        </div>

        <p className="consent-h">The author declares</p>
        <ul className="consent-caps">
          <li className="consent-cap consent-cap--muted">
            <span>{declaredSummary(plan.declared)}</span>
          </li>
          <li className="consent-cap consent-cap--muted">
            <span>Declared by the author — not enforced by Garret.</span>
          </li>
        </ul>

        <p className="consent-note">
          It will be added <strong>disabled</strong>. Nothing runs until you enable it — you'll be
          asked to confirm full access then.
        </p>

        <div className="consent-actions">
          <button className="consent-cancel" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="consent-install" onClick={onConfirm} disabled={busy}>
            {busy ? 'Installing…' : plan.isUpdate ? 'Update' : 'Install'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The full-access consent shown when the user ENABLES a native extension. States the truth plainly
 * (no sandbox, can run any program / read any file). Requires typing a fixed phrase that is NOT
 * shown pre-filled — a deliberate speed bump against the click-through reflex. Honest limits: this
 * guards accidental/habituated clicks, not a determined author whose code the user chose to trust.
 */
export function NativeEnableDialog({
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
  const [typed, setTyped] = useState('')
  const armed = typed.trim().toLowerCase() === ENABLE_PHRASE.toLowerCase()
  return (
    <div className="consent-backdrop" onClick={onCancel}>
      <div className="consent-card" onClick={(e) => e.stopPropagation()}>
        <div className="consent-head">
          <span className="consent-icon consent-icon--danger">
            <TriangleAlert size={22} strokeWidth={1.75} />
          </span>
          <div className="consent-head-text">
            <h3 className="consent-title">Enable “{ext.name}”?</h3>
            <div className="consent-source" title={ext.source}>
              v{ext.version} · {ext.source}
            </div>
          </div>
        </div>

        <p className="consent-danger-lede">
          <strong>{ext.name}</strong> will run with <strong>full access to your Mac.</strong> It can
          read and change any file, run any program, and use the network — <strong>there is no
          sandbox.</strong>
        </p>

        <p className="consent-h">The author declares</p>
        <ul className="consent-caps">
          <li className="consent-cap consent-cap--muted">
            <span>{declaredSummary(ext.declared)}</span>
          </li>
        </ul>
        <p className="consent-note">
          These are declared by the author, not enforced by Garret. Only enable extensions from
          authors you trust.
        </p>

        <label className="consent-typebox">
          <span>
            To enable, type <code>{ENABLE_PHRASE}</code>
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={ENABLE_PHRASE}
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <div className="consent-actions">
          <button className="consent-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="consent-install consent-install--danger" onClick={onConfirm} disabled={busy || !armed}>
            {busy ? 'Enabling…' : 'Enable full access'}
          </button>
        </div>
      </div>
    </div>
  )
}
