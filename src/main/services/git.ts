import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename } from 'node:path'
import type { ServiceStatus } from '@shared/types/services'
import type { GitRepoStatus } from '@shared/types/git'
import type { BackendService } from './types'

const exec = promisify(execFile)

/** Run `git -C <cwd> <args>` (no shell → no injection). */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { timeout: 5000, windowsHide: true })
  return stdout.trim()
}
async function gitSafe(cwd: string, args: string[]): Promise<string> {
  try {
    return await git(cwd, args)
  } catch {
    return ''
  }
}

async function repoStatus(path: string): Promise<GitRepoStatus> {
  if (!path) throw new Error('No repository selected.')
  try {
    await git(path, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    throw new Error('Not a git repository.')
  }

  const branchRaw = await gitSafe(path, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const detached = branchRaw === 'HEAD' || branchRaw === ''
  const branch = detached
    ? (await gitSafe(path, ['rev-parse', '--short', 'HEAD'])) || 'detached'
    : branchRaw

  let ahead = 0
  let behind = 0
  let hasUpstream = false
  const ab = await gitSafe(path, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
  if (ab) {
    const [b, a] = ab.split(/\s+/).map(Number)
    behind = b || 0
    ahead = a || 0
    hasUpstream = true
  }

  const porcelain = await gitSafe(path, ['status', '--porcelain'])
  const lines = porcelain.split('\n').filter(Boolean)
  let staged = 0
  let modified = 0
  let untracked = 0
  for (const line of lines) {
    if (line.startsWith('??')) {
      untracked++
      continue
    }
    const x = line[0]
    const y = line[1]
    if (x !== ' ' && x !== '?') staged++
    if (y !== ' ' && y !== '?') modified++
  }

  let lastCommit: GitRepoStatus['lastCommit']
  const log = await gitSafe(path, ['log', '-1', '--format=%h%x1f%s%x1f%cr%x1f%an'])
  if (log) {
    const [hash, subject, relTime, author] = log.split('\x1f')
    lastCommit = { hash, subject, relTime, author }
  }

  return {
    path,
    repo: basename(path),
    branch,
    detached,
    hasUpstream,
    ahead,
    behind,
    staged,
    modified,
    untracked,
    dirty: lines.length,
    lastCommit
  }
}

async function repoStatusMulti(paths: string[]): Promise<GitRepoStatus[]> {
  return Promise.all(
    paths.map(async (p) => {
      try {
        return await repoStatus(p)
      } catch (e) {
        return {
          path: p,
          repo: basename(p),
          error: (e as Error).message,
          branch: '',
          detached: false,
          hasUpstream: false,
          ahead: 0,
          behind: 0,
          staged: 0,
          modified: 0,
          untracked: 0,
          dirty: 0
        }
      }
    })
  )
}

/** Local git data source — no auth; reuses the poll scheduler like a service. */
export const gitService: BackendService = {
  id: 'git',
  async status(): Promise<ServiceStatus> {
    return { connected: true }
  },
  async connect(): Promise<ServiceStatus> {
    return { connected: true }
  },
  async disconnect(): Promise<ServiceStatus> {
    return { connected: false }
  },
  async query(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === 'repoStatus') return repoStatus(String(params.path ?? ''))
    if (method === 'repoStatusMulti') {
      const paths = Array.isArray(params.paths) ? params.paths.map(String).filter(Boolean) : []
      return repoStatusMulti(paths)
    }
    throw new Error(`Unknown git method: ${method}`)
  }
}
