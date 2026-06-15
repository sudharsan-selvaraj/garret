import type { ReactNode } from 'react'
import { useServiceStatus, type WidgetSettingsProps } from '@sdk'

export interface RepoConfig {
  title: string
  repos: string
  state: string
  refreshMin: string
  notify: boolean
}

/** Parse the repos textarea ("workspace/repo" per line) into an array for the query. */
export function parseReposConfig(repos: string): string[] {
  return (repos ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function RepoSettings({
  config,
  onChange,
  notifyLabel
}: WidgetSettingsProps<RepoConfig> & { notifyLabel: string }): JSX.Element {
  const { status } = useServiceStatus('atlassian')
  if (!status?.connected) {
    return <div className="svc-empty">Connect Atlassian in the Settings (⚙ in the toolbar) first.</div>
  }

  return (
    <div className="settings-form">
      <div className="settings-item">
        <label className="settings-section-label">Repositories</label>
        <textarea
          className="repos-input"
          rows={4}
          placeholder={'workspace/repo\nworkspace/another-repo'}
          value={config.repos}
          onChange={(e) => onChange({ repos: e.target.value })}
        />
        <p className="settings-note">One workspace/repo per line. Pasted bitbucket.org URLs work too.</p>
      </div>

      <div className="settings-item">
        <div className="settings-group">
          <Row label="Title">
            <input className="row-input" placeholder="optional" value={config.title} onChange={(e) => onChange({ title: e.target.value })} />
          </Row>
          <Row label="State">
            <select className="row-select" value={config.state} onChange={(e) => onChange({ state: e.target.value })}>
              <option value="OPEN">Open</option>
              <option value="MERGED">Merged</option>
              <option value="DECLINED">Declined</option>
              <option value="ALL">All</option>
            </select>
          </Row>
          <Row label="Refresh every">
            <select className="row-select" value={config.refreshMin} onChange={(e) => onChange({ refreshMin: e.target.value })}>
              <option value="0">Manual</option>
              <option value="1">1 min</option>
              <option value="5">5 min</option>
              <option value="15">15 min</option>
            </select>
          </Row>
          <Row label={notifyLabel}>
            <Switch on={config.notify} onChange={(v) => onChange({ notify: v })} />
          </Row>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="settings-row">
      <label className="settings-row-label">{label}</label>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}
function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={on} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  )
}
