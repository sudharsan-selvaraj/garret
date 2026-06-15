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
}
