/** A normalized Bitbucket pull request (subset we render). */
export interface BitbucketPR {
  id: number
  title: string
  /** OPEN | MERGED | DECLINED | SUPERSEDED */
  state: string
  author?: string
  sourceBranch?: string
  destBranch?: string
  commentCount?: number
  /** ISO created timestamp (for notification high-water-mark). */
  created?: string
  url: string
  /** "workspace/repo" — set for multi-repo widgets, used for grouping. */
  repo?: string
  /** Your review state on this PR (review widget): 'approved' | 'changes_requested' | 'pending'. */
  reviewState?: string
}
