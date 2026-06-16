import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown,
  ArrowUp,
  FolderGit2,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  Plus,
  SquarePen,
  X
} from 'lucide-react'
import {
  defineWidget,
  field,
  useFileWatch,
  usePolledQuery,
  type WidgetRenderProps,
  type WidgetSettingsProps
} from '@sdk'
import type { GitRepoStatus } from '@shared/types/git'

interface RepoEntry {
  path: string
  editor: string // '' | 'vscode' | 'cursor' | 'intellij'
}
interface Config {
  title: string
  repos: RepoEntry[]
  /** legacy (pre-editor) plain-path list — read once for back-compat. */
  paths?: string
}

const EDITOR_LABEL: Record<string, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  intellij: 'IntelliJ IDEA'
}
const SAFETY_INTERVAL = 10 * 60_000
const IGNORE = ['/node_modules/', '/.git/objects/', '/.git/lfs/', '/.git/modules/']

function getRepos(c: Config): RepoEntry[] {
  if (Array.isArray(c.repos)) return c.repos
  if (typeof c.paths === 'string') {
    return c.paths
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((path) => ({ path, editor: '' }))
  }
  return []
}
function baseName(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}

/* ---------------- Render ---------------- */

function GitRepos({ config, ctx }: WidgetRenderProps<Config>): JSX.Element {
  const repos = getRepos(config)
  const paths = repos.map((r) => r.path)
  const fileVersion = useFileWatch(paths, { recursive: true, ignore: IGNORE })
  const { data, error, loading } = usePolledQuery<GitRepoStatus[]>(
    'git',
    'repoStatusMulti',
    { paths },
    { intervalMs: SAFETY_INTERVAL, refreshToken: ctx.refreshToken + fileVersion }
  )

  if (repos.length === 0) return <div className="svc-empty">Add repos in ⚙ settings.</div>
  if (error) return <div className="svc-empty">{error}</div>
  if (!data && loading) return <div className="svc-empty">Loading…</div>

  const byPath = new Map((data ?? []).map((s) => [s.path, s]))

  return (
    <div className="git-list">
      {config.title && <div className="list-caption">{config.title}</div>}
      {repos.map((entry) => {
        const r = byPath.get(entry.path)
        return (
          <div className="git-row" key={entry.path}>
            <div className="git-row-top">
              <span className="git-repo-name">{r?.repo ?? baseName(entry.path)}</span>
              {!r ? (
                <span className="git-row-err">…</span>
              ) : r.error ? (
                <span className="git-row-err">{r.error}</span>
              ) : (
                <>
                  <span className="git-branch-inline">
                    <GitBranch size={12} strokeWidth={2} />
                    {r.branch}
                  </span>
                  {r.hasUpstream && (r.ahead > 0 || r.behind > 0) && (
                    <span className="git-sync">
                      {r.ahead > 0 && (
                        <span className="git-ahead">
                          <ArrowUp size={11} strokeWidth={2.5} />
                          {r.ahead}
                        </span>
                      )}
                      {r.behind > 0 && (
                        <span className="git-behind">
                          <ArrowDown size={11} strokeWidth={2.5} />
                          {r.behind}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="git-row-changes">
                    {r.dirty === 0 ? (
                      <span className="git-clean">✓ clean</span>
                    ) : (
                      <>
                        {r.staged > 0 && (
                          <span className="git-dot staged" title={`${r.staged} staged`}>+{r.staged}</span>
                        )}
                        {r.modified > 0 && (
                          <span className="git-dot modified" title={`${r.modified} modified`}>~{r.modified}</span>
                        )}
                        {r.untracked > 0 && (
                          <span className="git-dot untracked" title={`${r.untracked} untracked`}>?{r.untracked}</span>
                        )}
                      </>
                    )}
                  </span>
                </>
              )}
              <RowMenu entry={entry} />
            </div>
            {r && !r.error && r.lastCommit && (
              <div className="git-row-commit">
                <code>{r.lastCommit.hash}</code>
                <span className="git-commit-subject">{r.lastCommit.subject}</span>
                <span className="git-commit-time">{r.lastCommit.relTime}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RowMenu({ entry }: { entry: RepoEntry }): JSX.Element {
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
      {pos && <RowMenuPopover x={pos.x} y={pos.y} entry={entry} onClose={() => setPos(null)} />}
    </>
  )
}

function RowMenuPopover({
  x,
  y,
  entry,
  onClose
}: {
  x: number
  y: number
  entry: RepoEntry
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [p, setP] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setP({ x: Math.min(x, window.innerWidth - width - 8), y: Math.min(y, window.innerHeight - height - 8) })
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
          window.myview.openPath(entry.path)
          onClose()
        }}
      >
        <span className="ctx-icon">
          <FolderOpen size={15} strokeWidth={1.75} />
        </span>
        <span className="ctx-label">Open directory</span>
      </button>
      {entry.editor && EDITOR_LABEL[entry.editor] && (
        <button
          className="ctx-item"
          onClick={() => {
            window.myview.openInEditor(entry.path, entry.editor)
            onClose()
          }}
        >
          <span className="ctx-icon">
            <SquarePen size={15} strokeWidth={1.75} />
          </span>
          <span className="ctx-label">Open in {EDITOR_LABEL[entry.editor]}</span>
        </button>
      )}
    </div>,
    document.body
  )
}

/* ---------------- Settings ---------------- */

function GitSettings({ config, onChange }: WidgetSettingsProps<Config>): JSX.Element {
  const repos = getRepos(config)
  const setRepos = (next: RepoEntry[]): void => onChange({ repos: next, paths: undefined })

  const addFolder = async (): Promise<void> => {
    const p = await window.myview.pickDirectory()
    if (!p || repos.some((r) => r.path === p)) return
    setRepos([...repos, { path: p, editor: 'vscode' }])
  }

  return (
    <div className="settings-form">
      <div className="settings-item">
        <div className="settings-group">
          <div className="settings-row">
            <label className="settings-row-label">Title</label>
            <div className="settings-row-control">
              <input
                className="row-input"
                placeholder="optional"
                value={config.title}
                onChange={(e) => onChange({ title: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="settings-item">
        <label className="settings-section-label">Repositories</label>
        {repos.length === 0 && <p className="settings-note">No repos yet — add one below.</p>}
        {repos.map((r, i) => (
          <div className="repo-edit-row" key={r.path}>
            <span className="repo-edit-path" title={r.path}>
              {baseName(r.path)}
            </span>
            <select
              className="row-select repo-edit-editor"
              value={r.editor}
              onChange={(e) => setRepos(repos.map((x, idx) => (idx === i ? { ...x, editor: e.target.value } : x)))}
            >
              <option value="">No editor</option>
              <option value="vscode">VS Code</option>
              <option value="cursor">Cursor</option>
              <option value="intellij">IntelliJ IDEA</option>
            </select>
            <button
              className="repo-edit-remove"
              title="Remove"
              onClick={() => setRepos(repos.filter((_, idx) => idx !== i))}
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
        ))}
        <button className="git-pick" onClick={addFolder}>
          <Plus size={14} strokeWidth={2.25} /> Add folder…
        </button>
        <p className="settings-note">
          Pick an editor per repo — the ⋯ menu on each row can open it in that IDE. Updates live
          via a file watcher.
        </p>
      </div>
    </div>
  )
}

export default defineWidget<Config>({
  manifest: {
    id: 'git-repo',
    name: 'Git Repos',
    icon: FolderGit2,
    description: 'Local git repos at a glance — branch, ahead/behind, changes, last commit.',
    defaultSize: { w: 5, h: 6 },
    minSize: { w: 3, h: 3 },
    capabilities: { refreshable: true },
    configSchema: {
      title: field.text({ label: 'Title' })
    }
  },
  render: GitRepos,
  Settings: GitSettings
})
