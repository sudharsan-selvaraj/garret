import type { ReactNode } from 'react'
import { GitPullRequest } from 'lucide-react'
import {
  defineWidget,
  field,
  openExternal,
  usePolledQuery,
  useServiceStatus,
  type WidgetRenderProps,
  type WidgetSettingsProps
} from '@sdk'
import type { BitbucketPR } from '@shared/types/bitbucket'

interface Config {
  title: string
  workspace: string
  repo: string
  state: string
  maxResults: number | string
  refreshMin: string
  notify: boolean
}

const SERVICE = 'atlassian'

const STATE_CLASS: Record<string, string> = {
  OPEN: 'open',
  MERGED: 'merged',
  DECLINED: 'declined',
  SUPERSEDED: 'declined'
}

function prParams(c: Config): Record<string, unknown> {
  return {
    workspace: c.workspace?.trim() ?? '',
    repo: c.repo?.trim() ?? '',
    state: c.state || 'OPEN',
    maxResults: Number(c.maxResults) || 15
  }
}
function intervalFor(c: Config): number {
  const m = Number(c.refreshMin)
  return m > 0 ? m * 60_000 : 24 * 60 * 60_000
}

/* ---------------- Render ---------------- */

function BitbucketPRs({ config, ctx }: WidgetRenderProps<Config>): JSX.Element {
  const ready = Boolean(config.workspace?.trim() && config.repo?.trim())
  const { data: prs, error, loading } = usePolledQuery<BitbucketPR[]>(
    SERVICE,
    'listPullRequests',
    prParams(config),
    { intervalMs: intervalFor(config), refreshToken: ctx.refreshToken }
  )

  if (!ready) return <div className="svc-empty">Set a workspace and repo in ⚙ settings.</div>
  if (error) {
    const notConnected = /not connected/i.test(error)
    return (
      <div className="svc-empty">
        {notConnected ? 'Connect Atlassian in ⚙ settings to see pull requests.' : error}
      </div>
    )
  }
  if (!prs && loading) return <div className="svc-empty">Loading…</div>
  if (prs && prs.length === 0) return <div className="svc-empty">No matching pull requests.</div>

  return (
    <div className="ticket-list">
      {config.title && <div className="list-caption">{config.title}</div>}
      {(prs ?? []).map((pr) => (
        <button
          key={pr.id}
          className="ticket"
          onClick={() => openExternal(pr.url)}
          title={`${pr.title}${pr.author ? ` · ${pr.author}` : ''}${
            pr.sourceBranch ? ` · ${pr.sourceBranch} → ${pr.destBranch}` : ''
          }`}
        >
          <span className="ticket-key">#{pr.id}</span>
          <span className="ticket-summary">{pr.title}</span>
          <span className={`status-pill ${STATE_CLASS[pr.state] ?? 'open'}`}>{pr.state}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------------- Settings ---------------- */

function BitbucketSettings({ config, onChange }: WidgetSettingsProps<Config>): JSX.Element {
  const { status } = useServiceStatus(SERVICE)

  if (!status?.connected) {
    return (
      <div className="svc-empty">
        Connect Atlassian in the Settings (⚙ in the toolbar), then configure this widget’s
        filters here.
      </div>
    )
  }

  return (
    <div className="settings-form">
      <div className="settings-item">
        <div className="settings-group">
          <Row label="Title">
            <input className="row-input" placeholder="optional" value={config.title} onChange={(e) => onChange({ title: e.target.value })} />
          </Row>
          <Row label="Workspace">
            <input className="row-input" placeholder="my-workspace" value={config.workspace} onChange={(e) => onChange({ workspace: e.target.value })} />
          </Row>
          <Row label="Repo">
            <input className="row-input" placeholder="my-repo" value={config.repo} onChange={(e) => onChange({ repo: e.target.value })} />
          </Row>
          <Row label="State">
            <select className="row-select" value={config.state} onChange={(e) => onChange({ state: e.target.value })}>
              <option value="OPEN">Open</option>
              <option value="MERGED">Merged</option>
              <option value="DECLINED">Declined</option>
            </select>
          </Row>
          <Row label="Max results">
            <input className="row-input" type="number" value={String(config.maxResults)} onChange={(e) => onChange({ maxResults: e.target.value })} />
          </Row>
        </div>
      </div>

      <div className="settings-item">
        <div className="settings-group">
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
          <Row label="Notify on new PRs">
            <Switch on={config.notify} onChange={(v) => onChange({ notify: v })} />
          </Row>
        </div>
        <p className="settings-note">Notifications run in the background, even when this layout isn’t open.</p>
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

export default defineWidget<Config>({
  manifest: {
    id: 'bitbucket-prs',
    name: 'Bitbucket PRs',
    icon: GitPullRequest,
    serviceId: 'atlassian',
    description: 'Pull requests for a repo, filtered by state (live, not an embed).',
    defaultSize: { w: 5, h: 7 },
    minSize: { w: 3, h: 3 },
    capabilities: { refreshable: true },
    poll: (c: Config) =>
      c.workspace?.trim() && c.repo?.trim()
        ? { method: 'listPullRequests', params: prParams(c) }
        : null,
    notifySpec: { idPath: 'id', titlePath: 'title', urlPath: 'url', createdPath: 'created' },
    configSchema: {
      title: field.text({ label: 'Title' }),
      workspace: field.text({ label: 'Workspace' }),
      repo: field.text({ label: 'Repo' }),
      state: field.select({
        label: 'State',
        default: 'OPEN',
        options: [
          { label: 'Open', value: 'OPEN' },
          { label: 'Merged', value: 'MERGED' },
          { label: 'Declined', value: 'DECLINED' }
        ]
      }),
      maxResults: field.number({ label: 'Max results', default: 15 }),
      refreshMin: field.select({
        label: 'Refresh every',
        default: '5',
        options: [
          { label: 'Manual', value: '0' },
          { label: '1 min', value: '1' },
          { label: '5 min', value: '5' },
          { label: '15 min', value: '15' }
        ]
      }),
      notify: field.boolean({ label: 'Notify on new PRs', default: false })
    }
  },
  render: BitbucketPRs,
  Settings: BitbucketSettings
})
