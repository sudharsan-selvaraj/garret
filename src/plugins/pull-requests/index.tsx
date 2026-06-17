import { GitPullRequest, MessageSquare } from 'lucide-react'
import { defineWidget, field, usePolledQuery, type WidgetRenderProps } from '@sdk'
import type { BitbucketPR } from '@shared/types/bitbucket'
import { GroupedPrList } from '@plugins/_bitbucket/GroupedPrList'
import {
  RepoSettings,
  filterPRs,
  parseReposConfig,
  prQuery,
  type RepoConfig
} from '@plugins/_bitbucket/RepoSettings'

const SERVICE = 'atlassian'
const STATE_CLASS: Record<string, string> = { OPEN: 'open', MERGED: 'merged', DECLINED: 'declined' }
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

function intervalFor(c: RepoConfig): number {
  const m = Number(c.refreshMin)
  return m > 0 ? m * 60_000 : 24 * 60 * 60_000
}

/** Inline reviewer indicators — a dot per reviewer, colored by approval state. */
function ReviewerDots({ reviewers }: { reviewers: NonNullable<BitbucketPR['reviewers']> }): JSX.Element {
  const shown = reviewers.slice(0, 4)
  const extra = reviewers.length - shown.length
  return (
    <span className="pr-reviewers" title={reviewers.map((r) => r.name ?? '').filter(Boolean).join(', ')}>
      {shown.map((r, i) => (
        <span key={i} className={`pr-rev-dot ${r.state ?? 'pending'}`} title={`${r.name ?? ''} · ${r.state ?? 'pending'}`} />
      ))}
      {extra > 0 && <span className="pr-rev-more">+{extra}</span>}
    </span>
  )
}

function PullRequests({ config, ctx }: WidgetRenderProps<RepoConfig>): JSX.Element {
  const { data, error, loading, refresh } = usePolledQuery<BitbucketPR[]>(SERVICE, 'listPRs', prQuery(config), {
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
        empty="No matching pull requests."
        onMute={mute}
        onRetry={refresh}
        meta={(pr) => (
          <>
            {pr.author && <span className="pr-author">{pr.author}</span>}
            {pr.reviewers && pr.reviewers.length > 0 && <ReviewerDots reviewers={pr.reviewers} />}
            {pr.commentCount ? (
              <span className="pr-comments">
                <MessageSquare size={11} strokeWidth={2} /> {pr.commentCount}
              </span>
            ) : null}
            {pr.reviewState ? (
              <span className={`status-pill ${REVIEW_CLASS[pr.reviewState] ?? 'todo'}`}>
                {REVIEW_LABEL[pr.reviewState] ?? 'Review'}
              </span>
            ) : (
              <span className={`status-pill ${STATE_CLASS[pr.state] ?? 'open'}`}>{pr.state}</span>
            )}
          </>
        )}
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
    id: 'pull-requests',
    name: 'Pull Requests',
    icon: GitPullRequest,
    serviceId: 'atlassian',
    description: 'Bitbucket PRs across repos — filter by author, reviewer & state; add one per need.',
    defaultSize: { w: 5, h: 8 },
    minSize: { w: 3, h: 4 },
    capabilities: { refreshable: true },
    poll: (c: RepoConfig) =>
      parseReposConfig(c.repos).length ? { method: 'listPRs', params: prQuery(c) } : null,
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
      author: field.select({
        label: 'Author',
        default: 'anyone',
        options: [
          { label: 'Anyone', value: 'anyone' },
          { label: 'Me', value: 'me' },
          { label: 'Someone', value: 'name' }
        ]
      }),
      authorName: field.text({ label: 'Author name' }),
      reviewer: field.select({
        label: 'Reviewer',
        default: 'anyone',
        options: [
          { label: 'Anyone', value: 'anyone' },
          { label: 'Me', value: 'me' }
        ]
      }),
      reviewState: field.select({
        label: 'My review',
        default: 'any',
        options: [
          { label: 'Any', value: 'any' },
          { label: 'Needs my review', value: 'pending' },
          { label: 'Approved', value: 'approved' },
          { label: 'Changes requested', value: 'changes_requested' }
        ]
      }),
      refreshMin: field.number({ label: 'Refresh (min)', default: 5 }),
      notify: field.boolean({ label: 'Notify on new', default: false })
    }
  },
  render: PullRequests,
  Settings: (props) => <RepoSettings {...props} notifyLabel="Notify on new PRs" />
})
