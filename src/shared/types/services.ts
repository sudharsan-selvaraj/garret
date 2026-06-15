/** Connection status of a backend service (Jira, Bitbucket, Google, …). */
export interface ServiceStatus {
  connected: boolean
  /** Display name / email of the connected account, when connected. */
  account?: string
  /** Error message, when a connect attempt or status check failed. */
  error?: string
}
