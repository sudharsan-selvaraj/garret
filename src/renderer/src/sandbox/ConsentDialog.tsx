import { type ComponentType } from 'react'
import {
  Blocks,
  Database,
  FolderOpen,
  Globe,
  KeyRound,
  ShieldCheck,
  SquareArrowOutUpRight
} from 'lucide-react'
import type { InstallPlan } from '@shared/types/sandbox'

/** Plain-language description of a declared permission for the consent screen. */
export function describePermission(p: string): string {
  if (p.startsWith('service:')) return `Read your ${p.slice('service:'.length)} data`
  if (p.startsWith('network:')) return `Connect to ${p.slice('network:'.length)}`
  if (p === 'files:read') return 'Read files you point it at'
  if (p === 'openExternal') return 'Open links in your browser (asks each time)'
  return p
}

/** Icon for a declared permission (consent screen rows). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function permIcon(p: string): ComponentType<any> {
  if (p.startsWith('service:')) return KeyRound
  if (p.startsWith('network:')) return Globe
  if (p === 'files:read') return FolderOpen
  if (p === 'openExternal') return SquareArrowOutUpRight
  return ShieldCheck
}

/** The install/update consent screen — shared by the Settings pane and the open-a-.garret flow. */
export function ConsentDialog({
  plan,
  busy,
  onConfirm,
  onCancel
}: {
  plan: InstallPlan
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const cap = (p: string): JSX.Element => {
    const Icon = permIcon(p)
    return (
      <li key={p} className="consent-cap">
        <span className="consent-cap-ic">
          <Icon size={14} strokeWidth={1.75} />
        </span>
        <span>{describePermission(p)}</span>
      </li>
    )
  }

  return (
    <div className="consent-backdrop" onClick={onCancel}>
      <div className="consent-card" onClick={(e) => e.stopPropagation()}>
        <div className="consent-head">
          <span className="consent-icon">
            <Blocks size={22} strokeWidth={1.75} />
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

        <div className="consent-badge">
          <ShieldCheck size={13} strokeWidth={2} /> Runs sandboxed &amp; isolated · unverified author
        </div>

        <p className="consent-h">This widget can</p>
        <ul className="consent-caps">
          {plan.permissions.map(cap)}
          <li className="consent-cap consent-cap--muted">
            <span className="consent-cap-ic">
              <Database size={14} strokeWidth={1.75} />
            </span>
            <span>Store its own settings locally (isolated to this widget)</span>
          </li>
          {plan.permissions.length === 0 && (
            <li className="consent-cap consent-cap--muted">
              <span className="consent-cap-ic">
                <ShieldCheck size={14} strokeWidth={1.75} />
              </span>
              <span>Nothing else — no network or account access</span>
            </li>
          )}
        </ul>

        {plan.isUpdate && plan.addedPermissions.length > 0 && (
          <>
            <p className="consent-h consent-new">New access since you installed it</p>
            <ul className="consent-caps consent-caps--new">{plan.addedPermissions.map(cap)}</ul>
          </>
        )}

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
