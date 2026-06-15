import { secrets } from '@main/persistence/secrets'
import type { ServiceStatus } from '@shared/types/services'
import type { JiraIssue } from '@shared/types/jira'
import type { BitbucketPR } from '@shared/types/bitbucket'
import { ServiceError, type BackendService } from './types'

const SECRET_KEY = 'service:atlassian'
const BB_BASE = 'https://api.bitbucket.org/2.0'

/** Parse a Retry-After header (seconds) into ms. */
function retryAfter(res: Response): number | undefined {
  const h = res.headers.get('retry-after')
  if (!h) return undefined
  const secs = Number(h)
  return Number.isFinite(secs) ? secs * 1000 : undefined
}

/**
 * One Atlassian account powers both Jira and Bitbucket — same email + API token
 * (Bitbucket retired app passwords). Jira additionally needs the site URL.
 */
interface Creds {
  email: string
  apiToken: string
  jiraSite?: string
  /** Optional Bitbucket Access Token (Bearer) — used when the API token lacks Bitbucket scope. */
  bitbucketToken?: string
}

let migrated = false
/** One-time migration from the previous split `service:jira` / `service:bitbucket` secrets. */
function ensureMigrated(): void {
  if (migrated) return
  migrated = true
  if (secrets.has(SECRET_KEY)) return
  const jiraRaw = secrets.get('service:jira')
  const bbRaw = secrets.get('service:bitbucket')
  if (!jiraRaw && !bbRaw) return
  const j = jiraRaw ? (JSON.parse(jiraRaw) as { site?: string; email?: string; token?: string }) : null
  const b = bbRaw ? (JSON.parse(bbRaw) as { email?: string; apiToken?: string }) : null
  const creds: Creds = {
    email: j?.email ?? b?.email ?? '',
    apiToken: j?.token ?? b?.apiToken ?? '',
    jiraSite: j?.site
  }
  if (creds.email && creds.apiToken) secrets.set(SECRET_KEY, JSON.stringify(creds))
  secrets.delete('service:jira')
  secrets.delete('service:bitbucket')
}

function loadCreds(): Creds | null {
  ensureMigrated()
  const raw = secrets.get(SECRET_KEY)
  return raw ? (JSON.parse(raw) as Creds) : null
}

function normalizeSite(site: string): string {
  let s = site.trim().replace(/\/+$/, '')
  if (s && !/^https?:\/\//i.test(s)) s = `https://${s}`
  return s
}

function basic(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
}

async function jiraCall(creds: Creds, path: string, init?: RequestInit): Promise<unknown> {
  if (!creds.jiraSite) throw new Error('Set the Jira site in Atlassian settings.')
  const res = await fetch(`${creds.jiraSite}${path}`, {
    ...init,
    headers: {
      Authorization: basic(creds.email, creds.apiToken),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init?.headers
    }
  })
  if (!res.ok) {
    let msg = `Jira request failed (${res.status}).`
    if (res.status === 401 || res.status === 403) msg = 'Jira auth failed — check email / API token.'
    else if (res.status === 404) msg = 'Jira not found — check the site URL.'
    else if (res.status === 429) msg = 'Jira rate-limited.'
    throw new ServiceError(msg, res.status, retryAfter(res))
  }
  return res.json()
}

async function bbCall(creds: Creds, path: string): Promise<unknown> {
  // Bitbucket accepts the Atlassian API token via Basic auth (email:token) on
  // resource endpoints — use a Bitbucket-specific token if provided, else the
  // shared one. (Note: /2.0/user and list endpoints are NOT supported for API
  // tokens; only concrete repo/PR endpoints are.)
  const token = creds.bitbucketToken || creds.apiToken
  const res = await fetch(`${BB_BASE}${path}`, {
    headers: { Authorization: basic(creds.email, token), Accept: 'application/json' }
  })
  if (!res.ok) {
    let msg = `Bitbucket request failed (${res.status}).`
    if (res.status === 401 || res.status === 403) {
      msg =
        'Bitbucket auth failed — this token lacks Bitbucket access. Use an API token with Bitbucket read scopes, or set a separate Bitbucket token in Settings.'
    } else if (res.status === 404) msg = 'Bitbucket not found — check workspace / repo.'
    else if (res.status === 429) msg = 'Bitbucket rate-limited.'
    throw new ServiceError(msg, res.status, retryAfter(res))
  }
  return res.json()
}

/* ---- normalizers ---- */

interface RawIssue {
  key: string
  fields: {
    summary: string
    status?: { name?: string; statusCategory?: { name?: string } }
    assignee?: { displayName?: string; avatarUrls?: Record<string, string> }
    priority?: { name?: string }
    issuetype?: { name?: string }
    created?: string
  }
}
function normalizeIssue(site: string, raw: RawIssue): JiraIssue {
  const f = raw.fields
  return {
    key: raw.key,
    summary: f.summary,
    statusName: f.status?.name ?? 'Unknown',
    statusCategory: f.status?.statusCategory?.name ?? 'To Do',
    assignee: f.assignee ? { name: f.assignee.displayName ?? 'Unassigned' } : undefined,
    priority: f.priority?.name,
    type: f.issuetype?.name,
    created: f.created,
    url: `${site}/browse/${raw.key}`
  }
}

interface RawPR {
  id: number
  title: string
  state: string
  author?: { display_name?: string }
  source?: { branch?: { name?: string } }
  destination?: { branch?: { name?: string } }
  comment_count?: number
  created_on?: string
  links?: { html?: { href?: string } }
}
function normalizePR(pr: RawPR): BitbucketPR {
  return {
    id: pr.id,
    title: pr.title,
    state: pr.state,
    author: pr.author?.display_name,
    sourceBranch: pr.source?.branch?.name,
    destBranch: pr.destination?.branch?.name,
    commentCount: pr.comment_count,
    created: pr.created_on,
    url: pr.links?.html?.href ?? ''
  }
}

/**
 * Validate credentials. Jira `/myself` is the only reliably-checkable endpoint
 * (Bitbucket's account/list endpoints are deprecated/unsupported for API tokens,
 * and its real endpoints need a repo) — so we verify Jira when a site is given,
 * and otherwise accept the token (the widget's repo query is the real check).
 */
async function validate(creds: Creds): Promise<ServiceStatus> {
  if (creds.jiraSite) {
    try {
      const me = (await jiraCall(creds, '/rest/api/3/myself')) as { displayName?: string }
      return { connected: true, account: me.displayName }
    } catch (err) {
      return { connected: false, error: `Jira: ${(err as Error).message}` }
    }
  }
  if (creds.apiToken || creds.bitbucketToken) {
    return { connected: true, account: creds.email || 'Atlassian account' }
  }
  return { connected: false, error: 'Provide an API token.' }
}

export const atlassianService: BackendService = {
  id: 'atlassian',

  async status(): Promise<ServiceStatus> {
    const creds = loadCreds()
    if (!creds) return { connected: false }
    return validate(creds)
  },

  async connect(input: Record<string, unknown>): Promise<ServiceStatus> {
    const creds: Creds = {
      email: String(input.email ?? '').trim(),
      apiToken: String(input.apiToken ?? '').trim(),
      jiraSite: normalizeSite(String(input.jiraSite ?? '')),
      bitbucketToken: String(input.bitbucketToken ?? '').trim() || undefined
    }
    if (!creds.email || !creds.apiToken) {
      return { connected: false, error: 'Email and API token are required.' }
    }
    const status = await validate(creds)
    if (status.connected) secrets.set(SECRET_KEY, JSON.stringify(creds))
    return status
  },

  async disconnect(): Promise<ServiceStatus> {
    secrets.delete(SECRET_KEY)
    return { connected: false }
  },

  async query(method: string, params: Record<string, unknown>): Promise<unknown> {
    const creds = loadCreds()
    if (!creds) throw new Error('Not connected')

    if (method === 'searchIssues') {
      const jql = String(params.jql ?? 'order by updated DESC')
      const maxResults = Number(params.maxResults) || 15
      const data = (await jiraCall(creds, '/rest/api/3/search/jql', {
        method: 'POST',
        body: JSON.stringify({
          jql,
          maxResults,
          fields: ['summary', 'status', 'assignee', 'priority', 'issuetype', 'created']
        })
      })) as { issues?: RawIssue[] }
      return (data.issues ?? []).map((i) => normalizeIssue(creds.jiraSite as string, i))
    }

    if (method === 'listPullRequests') {
      const workspace = String(params.workspace ?? '').trim()
      const repo = String(params.repo ?? '').trim()
      const state = String(params.state ?? 'OPEN')
      const max = Number(params.maxResults) || 15
      if (!workspace || !repo) throw new Error('Workspace and repo are required.')
      const data = (await bbCall(
        creds,
        `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/pullrequests?state=${encodeURIComponent(state)}&pagelen=${max}&fields=values.id,values.title,values.state,values.author.display_name,values.source.branch.name,values.destination.branch.name,values.comment_count,values.created_on,values.links.html.href`
      )) as { values?: RawPR[] }
      return (data.values ?? []).map(normalizePR)
    }

    throw new Error(`Unknown Atlassian method: ${method}`)
  }
}
