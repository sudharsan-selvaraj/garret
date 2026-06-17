import type { ReactNode } from 'react'
import { useServiceStatus, type WidgetSettingsProps } from '@sdk'
import type { BitbucketPR } from '@shared/types/bitbucket'

export interface RepoConfig {
  title: string
  repos: string
  state: string
  refreshMin: string
  notify: boolean
  /** Author filter: 'anyone' | 'me' | 'name'. */
  author?: string
  /** Author display-name substring (when author === 'name'). */
  authorName?: string
  /** Reviewer filter: 'anyone' | 'me'. */
  reviewer?: string
  /** My review status (when reviewer === 'me'): 'any'|'pending'|'approved'|'changes_requested'. */
  reviewState?: string
  /** Hide PRs created more than this many days ago ('0' = no limit). */
  maxAgeDays?: string
  /** PR ids the user has manually muted (hidden from the list). */
  muted?: number[]
}

/** The PR query params derived from a widget's filter config. */
export function prQuery(config: RepoConfig): Record<string, unknown> {
  return {
    repos: parseReposConfig(config.repos),
    state: config.state || 'OPEN',
    author: config.author || 'anyone',
    authorName: config.author === 'name' ? config.authorName ?? '' : '',
    reviewer: config.reviewer || 'anyone',
    reviewState: config.reviewer === 'me' ? config.reviewState ?? 'any' : 'any'
  }
}

/** Parse the repos textarea ("workspace/repo" per line) into an array for the query. */
export function parseReposConfig(repos: string): string[] {
  return (repos ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Apply the client-side display filters: drop muted PRs and ones older than the cutoff. */
export function filterPRs(items: BitbucketPR[], config: RepoConfig): BitbucketPR[] {
  const maxAge = Number(config.maxAgeDays) || 0
  const muted = new Set(config.muted ?? [])
  const cutoff = maxAge > 0 ? Date.now() - maxAge * 86_400_000 : 0
  return items.filter((pr) => {
    if (muted.has(pr.id)) return false
    if (cutoff && pr.created && new Date(pr.created).getTime() < cutoff) return false
    return true
  })
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
          <Row label="Author">
            <select
              className="row-select"
              value={config.author || 'anyone'}
              onChange={(e) => onChange({ author: e.target.value })}
            >
              <option value="anyone">Anyone</option>
              <option value="me">Me</option>
              <option value="name">Someone…</option>
            </select>
          </Row>
          {config.author === 'name' && (
            <Row label="Author name">
              <input
                className="row-input"
                placeholder="name contains…"
                value={config.authorName ?? ''}
                onChange={(e) => onChange({ authorName: e.target.value })}
              />
            </Row>
          )}
          <Row label="Reviewer">
            <select
              className="row-select"
              value={config.reviewer || 'anyone'}
              onChange={(e) => onChange({ reviewer: e.target.value })}
            >
              <option value="anyone">Anyone</option>
              <option value="me">Me</option>
            </select>
          </Row>
          {config.reviewer === 'me' && (
            <Row label="My review">
              <select
                className="row-select"
                value={config.reviewState || 'any'}
                onChange={(e) => onChange({ reviewState: e.target.value })}
              >
                <option value="any">Any</option>
                <option value="pending">Needs my review</option>
                <option value="approved">Approved</option>
                <option value="changes_requested">Changes requested</option>
              </select>
            </Row>
          )}
          <Row label="Hide older than (days)">
            <input
              className="row-input"
              type="number"
              min={0}
              placeholder="0 = any age"
              value={config.maxAgeDays ?? ''}
              onChange={(e) => onChange({ maxAgeDays: e.target.value })}
            />
          </Row>
          <Row label="Refresh (min)">
            <input
              className="row-input"
              type="number"
              min={0}
              placeholder="0 = manual"
              value={config.refreshMin ?? ''}
              onChange={(e) => onChange({ refreshMin: e.target.value })}
            />
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
