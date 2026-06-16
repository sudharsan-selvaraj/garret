import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BellOff, ChevronDown, ChevronRight, ExternalLink, MoreHorizontal } from 'lucide-react'
import { openExternal } from '@sdk'
import type { BitbucketPR } from '@shared/types/bitbucket'

/** PRs grouped by repo into collapsible accordion sections. `meta` renders the right-side badges. */
export function GroupedPrList({
  items,
  loading,
  error,
  empty,
  meta,
  onMute
}: {
  items: BitbucketPR[] | undefined
  loading: boolean
  error: string | undefined
  empty: string
  meta: (pr: BitbucketPR) => ReactNode
  /** When provided, each row gets a ⋯ menu with a Mute action. */
  onMute?: (id: number) => void
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
                  <div className="pr-row" key={pr.id}>
                    <button className="ticket" onClick={() => openExternal(pr.url)} title={pr.title}>
                      <span className="ticket-key">#{pr.id}</span>
                      <span className="ticket-summary">{pr.title}</span>
                      {meta(pr)}
                    </button>
                    {onMute && <PrRowMenu pr={pr} onMute={onMute} />}
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function PrRowMenu({ pr, onMute }: { pr: BitbucketPR; onMute: (id: number) => void }): JSX.Element {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        className="row-kebab"
        title="Actions"
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          setPos({ x: r.right, y: r.bottom + 4 })
        }}
      >
        <MoreHorizontal size={14} strokeWidth={2} />
      </button>
      {pos && (
        <PrMenuPopover x={pos.x} y={pos.y} pr={pr} onMute={onMute} onClose={() => setPos(null)} />
      )}
    </>
  )
}

function PrMenuPopover({
  x,
  y,
  pr,
  onMute,
  onClose
}: {
  x: number
  y: number
  pr: BitbucketPR
  onMute: (id: number) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [p, setP] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setP({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8)
    })
  }, [x, y])

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: p.x, top: p.y }}>
      <button
        className="ctx-item"
        onClick={() => {
          openExternal(pr.url)
          onClose()
        }}
      >
        <span className="ctx-icon">
          <ExternalLink size={15} strokeWidth={1.75} />
        </span>
        <span className="ctx-label">Open in browser</span>
      </button>
      <button
        className="ctx-item"
        onClick={() => {
          onMute(pr.id)
          onClose()
        }}
      >
        <span className="ctx-icon">
          <BellOff size={15} strokeWidth={1.75} />
        </span>
        <span className="ctx-label">Mute this PR</span>
      </button>
    </div>,
    document.body
  )
}
