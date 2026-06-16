/** Snapshot of a local git repository's working state. */
export interface GitRepoStatus {
  /** Absolute path (set in multi-repo results). */
  path?: string
  /** Per-repo error (e.g. not a git repo), shown inline in multi-repo widgets. */
  error?: string
  repo: string
  branch: string
  detached: boolean
  hasUpstream: boolean
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
  dirty: number
  lastCommit?: { hash: string; subject: string; relTime: string; author: string }
}
