import type { ReactNode } from 'react'
import { SquareKanban } from 'lucide-react'
import {
  defineWidget,
  field,
  openExternal,
  usePolledQuery,
  useServiceStatus,
  type WidgetRenderProps,
  type WidgetSettingsProps
} from '@sdk'
import type { JiraIssue } from '@shared/types/jira'

interface Config {
  title: string
  project: string
  onlyMine: boolean
  statuses: string
  sprint: string
  jql: string
  maxResults: number | string
  refreshMin: string
  notify: boolean
}

const SERVICE = 'atlassian'

/** Compose JQL from the structured filters, unless an advanced JQL override is set. */
function buildJql(c: Config): string {
  if (c.jql?.trim()) return c.jql.trim()
  const parts: string[] = []
  if (c.project?.trim()) parts.push(`project = "${c.project.trim()}"`)
  if (c.onlyMine) parts.push('assignee = currentUser()')
  const statuses = (c.statuses ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (statuses.length) parts.push(`status in (${statuses.map((s) => `"${s}"`).join(', ')})`)
  if (c.sprint === 'open') parts.push('sprint in openSprints()')
  return `${parts.length ? parts.join(' AND ') + ' ' : ''}ORDER BY created DESC`
}

/** Single source of truth for the query — used by both render and the notify watch. */
function jiraQuery(c: Config): { method: string; params: Record<string, unknown> } {
  return { method: 'searchIssues', params: { jql: buildJql(c), maxResults: Number(c.maxResults) || 15 } }
}

function intervalFor(c: Config): number {
  const m = Number(c.refreshMin)
  return m > 0 ? m * 60_000 : 24 * 60 * 60_000
}

const CATEGORY_CLASS: Record<string, string> = {
  'To Do': 'todo',
  'In Progress': 'progress',
  Done: 'done'
}

/* ---------------- Render ---------------- */

function JiraTickets({ config, ctx }: WidgetRenderProps<Config>): JSX.Element {
  const q = jiraQuery(config)
  const { data: issues, error, loading } = usePolledQuery<JiraIssue[]>(SERVICE, q.method, q.params, {
    intervalMs: intervalFor(config),
    refreshToken: ctx.refreshToken
  })

  if (error) {
    const notConnected = /not connected/i.test(error)
    return (
      <div className="svc-empty">
        {notConnected ? 'Connect Atlassian in ⚙ settings to see your tickets.' : error}
      </div>
    )
  }
  if (!issues && loading) return <div className="svc-empty">Loading…</div>
  if (issues && issues.length === 0) return <div className="svc-empty">No matching tickets.</div>

  return (
    <div className="ticket-list">
      {config.title && <div className="list-caption">{config.title}</div>}
      {(issues ?? []).map((it) => (
        <button
          key={it.key}
          className="ticket"
          onClick={() => openExternal(it.url)}
          title={`${it.summary}${it.assignee ? ` · ${it.assignee.name}` : ''}`}
        >
          <span className="ticket-key">{it.key}</span>
          <span className="ticket-summary">{it.summary}</span>
          <span className={`status-pill ${CATEGORY_CLASS[it.statusCategory] ?? 'todo'}`}>
            {it.statusName}
          </span>
        </button>
      ))}
    </div>
  )
}

/* ---------------- Settings (filters + refresh/notify) ---------------- */

function JiraSettings({ config, onChange }: WidgetSettingsProps<Config>): JSX.Element {
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
          <Row label="Project key">
            <input className="row-input" placeholder="e.g. OCA" value={config.project} onChange={(e) => onChange({ project: e.target.value })} />
          </Row>
          <Row label="Only my issues">
            <Switch on={config.onlyMine} onChange={(v) => onChange({ onlyMine: v })} />
          </Row>
          <Row label="Statuses">
            <input className="row-input" placeholder="In Progress, In Review" value={config.statuses} onChange={(e) => onChange({ statuses: e.target.value })} />
          </Row>
          <Row label="Sprint">
            <select className="row-select" value={config.sprint} onChange={(e) => onChange({ sprint: e.target.value })}>
              <option value="any">Any</option>
              <option value="open">Active sprint</option>
            </select>
          </Row>
          <Row label="Max results">
            <input className="row-input" type="number" value={String(config.maxResults)} onChange={(e) => onChange({ maxResults: e.target.value })} />
          </Row>
        </div>
      </div>

      <div className="settings-item">
        <div className="settings-group">
          <Row label="Refresh every">
            <select className="row-select" value={config.refreshMin} onChange={(e) => onChange({ refreshMin: e.target.value })}>
              <option value="0">Manual</option>
              <option value="1">1 min</option>
              <option value="5">5 min</option>
              <option value="15">15 min</option>
            </select>
          </Row>
          <Row label="Notify on new tickets">
            <Switch on={config.notify} onChange={(v) => onChange({ notify: v })} />
          </Row>
        </div>
        <p className="settings-note">Notifications run in the background, even when this layout isn’t open.</p>
      </div>

      <div className="settings-item">
        <div className="settings-group">
          <Row label="JQL">
            <input className="row-input" placeholder="project = OCA AND assignee = currentUser()" value={config.jql} onChange={(e) => onChange({ jql: e.target.value })} />
          </Row>
        </div>
        <p className="settings-note">Advanced: a raw JQL overrides the filters above.</p>
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
    id: 'jira-tickets',
    name: 'Jira Tickets',
    icon: SquareKanban,
    serviceId: 'atlassian',
    description: 'A filtered list of Jira issues (live, not an embed).',
    defaultSize: { w: 5, h: 7 },
    minSize: { w: 3, h: 3 },
    capabilities: { refreshable: true },
    poll: (c: Config) => jiraQuery(c),
    notifySpec: { idPath: 'key', titlePath: 'summary', urlPath: 'url', createdPath: 'created' },
    configSchema: {
      title: field.text({ label: 'Title' }),
      project: field.text({ label: 'Project key' }),
      onlyMine: field.boolean({ label: 'Only my issues', default: true }),
      statuses: field.text({ label: 'Statuses' }),
      sprint: field.select({
        label: 'Sprint',
        default: 'any',
        options: [
          { label: 'Any', value: 'any' },
          { label: 'Active sprint', value: 'open' }
        ]
      }),
      jql: field.text({ label: 'JQL' }),
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
      notify: field.boolean({ label: 'Notify on new tickets', default: false })
    }
  },
  render: JiraTickets,
  Settings: JiraSettings
})
