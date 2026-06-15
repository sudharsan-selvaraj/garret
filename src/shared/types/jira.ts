/** A normalized Jira issue (subset we render). */
export interface JiraIssue {
  key: string
  summary: string
  statusName: string
  /** 'To Do' | 'In Progress' | 'Done' (drives the status dot colour). */
  statusCategory: string
  assignee?: { name: string; avatar?: string }
  priority?: string
  type?: string
  /** ISO created timestamp (for notification high-water-mark). */
  created?: string
  /** Direct browser link to the issue. */
  url: string
}
