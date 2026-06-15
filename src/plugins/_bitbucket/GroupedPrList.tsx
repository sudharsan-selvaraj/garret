import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { openExternal } from '@sdk'
import type { BitbucketPR } from '@shared/types/bitbucket'

/** PRs grouped by repo into collapsible accordion sections. `meta` renders the right-side badges. */
export function GroupedPrList({
  items,
  loading,
  error,
  empty,
  meta
}: {
  items: BitbucketPR[] | undefined
  loading: boolean
  error: string | undefined
  empty: string
  meta: (pr: BitbucketPR) => ReactNode
}): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  if (error) {
    const notConnected = /not connected|identify your account/i.test(error)
    return (
      <div className="svc-empty">
        {notConnected ? 'Connect Atlassian in ⚙ settings, then add repos here.' : error}
      </div>
    )
  }
  if (!items && loading) return <div className="svc-empty">Loading…</div>
  if (items && items.length === 0) return <div className="svc-empty">{empty}</div>

  const groups = new Map<string, BitbucketPR[]>()
  for (const pr of items ?? []) {
    const k = pr.repo ?? 'Other'
    const arr = groups.get(k) ?? []
    arr.push(pr)
    groups.set(k, arr)
  }

  const toggle = (repo: string): void =>
    setCollapsed((s) => {
      const n = new Set(s)
      n.has(repo) ? n.delete(repo) : n.add(repo)
      return n
    })

  return (
    <div className="pr-groups">
      {[...groups.entries()].map(([repo, prs]) => {
        const open = !collapsed.has(repo)
        return (
          <section className="pr-group" key={repo}>
            <button className="pr-group-head" onClick={() => toggle(repo)}>
              {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />}
              <span className="pr-group-name">{repo}</span>
              <span className="pr-group-count">{prs.length}</span>
            </button>
            {open && (
              <div className="pr-group-body">
                {prs.map((pr) => (
                  <button
                    key={pr.id}
                    className="ticket"
                    onClick={() => openExternal(pr.url)}
                    title={pr.title}
                  >
                    <span className="ticket-key">#{pr.id}</span>
                    <span className="ticket-summary">{pr.title}</span>
                    {meta(pr)}
                  </button>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
