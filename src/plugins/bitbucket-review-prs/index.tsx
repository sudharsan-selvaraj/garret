import { GitPullRequestDraft, MessageSquare } from 'lucide-react'
import { defineWidget, field, usePolledQuery, type WidgetRenderProps } from '@sdk'
import type { BitbucketPR } from '@shared/types/bitbucket'
import { GroupedPrList } from '@plugins/_bitbucket/GroupedPrList'
import {
  RepoSettings,
  filterPRs,
  parseReposConfig,
  type RepoConfig
} from '@plugins/_bitbucket/RepoSettings'

const SERVICE = 'atlassian'
const REVIEW_CLASS: Record<string, string> = {
  approved: 'done',
  changes_requested: 'declined',
  pending: 'todo'
}
const REVIEW_LABEL: Record<string, string> = {
  approved: 'Approved',
  changes_requested: 'Changes',
  pending: 'Review'
}

function queryOf(c: RepoConfig): { method: string; params: Record<string, unknown> } {
  return { method: 'listReviewPRs', params: { repos: parseReposConfig(c.repos), state: c.state || 'OPEN' } }
}
function intervalFor(c: RepoConfig): number {
  const m = Number(c.refreshMin)
  return m > 0 ? m * 60_000 : 24 * 60 * 60_000
}

function ReviewPRs({ config, ctx }: WidgetRenderProps<RepoConfig>): JSX.Element {
  const q = queryOf(config)
  const { data, error, loading } = usePolledQuery<BitbucketPR[]>(SERVICE, q.method, q.params, {
    intervalMs: intervalFor(config),
    refreshToken: ctx.refreshToken
  })

  if (parseReposConfig(config.repos).length === 0) {
    return <div className="svc-empty">Add one or more repos in ⚙ settings.</div>
  }

  const muted = config.muted ?? []
  const items = data ? filterPRs(data, config) : undefined
  const mute = (id: number): void => ctx.updateConfig({ muted: [...muted, id] })

  return (
    <div className="pr-widget">
      {config.title && <div className="list-caption">{config.title}</div>}
      <GroupedPrList
        items={items}
        loading={loading}
        error={error}
        empty="Nothing waiting on your review."
        onMute={mute}
        meta={(pr) => {
          const rs = pr.reviewState ?? 'pending'
          return (
            <>
              {pr.author && <span className="pr-author">{pr.author}</span>}
              {pr.commentCount ? (
                <span className="pr-comments">
                  <MessageSquare size={11} strokeWidth={2} /> {pr.commentCount}
                </span>
              ) : null}
              <span className={`status-pill ${REVIEW_CLASS[rs]}`}>{REVIEW_LABEL[rs]}</span>
            </>
          )
        }}
      />
      {muted.length > 0 && (
        <button className="pr-unmute" onClick={() => ctx.updateConfig({ muted: [] })}>
          {muted.length} muted · Unmute all
        </button>
      )}
    </div>
  )
}

export default defineWidget<RepoConfig>({
  manifest: {
    id: 'bitbucket-review-prs',
    name: 'PRs to Review',
    icon: GitPullRequestDraft,
    serviceId: 'atlassian',
    description: 'PRs waiting on your review across repos, grouped by repo.',
    defaultSize: { w: 5, h: 8 },
    minSize: { w: 3, h: 4 },
    capabilities: { refreshable: true },
    poll: (c: RepoConfig) =>
      parseReposConfig(c.repos).length ? queryOf(c) : null,
    notifySpec: { idPath: 'id', titlePath: 'title', urlPath: 'url', createdPath: 'created' },
    configSchema: {
      title: field.text({ label: 'Title' }),
      repos: field.text({ label: 'Repos' }),
      state: field.select({
        label: 'State',
        default: 'OPEN',
        options: [
          { label: 'Open', value: 'OPEN' },
          { label: 'Merged', value: 'MERGED' },
          { label: 'Declined', value: 'DECLINED' },
          { label: 'All', value: 'ALL' }
        ]
      }),
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
      notify: field.boolean({ label: 'Notify on new', default: false })
    }
  },
  render: ReviewPRs,
  Settings: (props) => <RepoSettings {...props} notifyLabel="Notify on new review requests" />
})
