import { useEffect, useState } from 'react'
import { Check, ChevronDown, Layers, Pencil, Plus, Settings, Trash2 } from 'lucide-react'
import { useBoardStore } from '@renderer/canvas/useBoardStore'
import { useUiStore } from '@renderer/app/useUiStore'

/** Floating toolbar: a small pill that expands on hover (or while the layout menu is open). */
export function Toolbar(): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const openSettings = useUiStore((s) => s.openSettings)
  const openAdd = useUiStore((s) => s.openAdd)
  const expanded = hovered || layoutOpen

  return (
    <header
      className={`toolbar${expanded ? ' expanded' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="brand" title="MyView">
        <Layers size={15} strokeWidth={2} />
      </div>
      <div className="toolbar-expand">
        <span className="brand-name">MyView</span>
        <LayoutMenu open={layoutOpen} setOpen={setLayoutOpen} />
        <button className="icon-btn" title="Settings" onClick={() => openSettings()}>
          <Settings size={16} strokeWidth={1.75} />
        </button>
        <button className="add-btn" onClick={openAdd}>
          <Plus size={15} strokeWidth={2.25} />
          <span>Add</span>
        </button>
      </div>
    </header>
  )
}

function LayoutMenu({
  open,
  setOpen
}: {
  open: boolean
  setOpen: (open: boolean) => void
}): JSX.Element {
  const active = useBoardStore((s) => s.activeLayout)
  const names = useBoardStore((s) => s.layoutNames)
  const switchLayout = useBoardStore((s) => s.switchLayout)
  const createLayout = useBoardStore((s) => s.createLayout)
  const deleteLayout = useBoardStore((s) => s.deleteLayout)
  const renameLayout = useBoardStore((s) => s.renameLayout)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const commitRename = (): void => {
    const to = draft.trim()
    if (editing && to && to !== editing && !names.includes(to)) void renameLayout(editing, to)
    setEditing(null)
  }

  // Close on Escape / outside click.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as Element)?.closest('.dropdown')) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [open, setOpen])

  const create = (): void => {
    const name = newName.trim()
    if (!name || names.includes(name)) return
    void createLayout(name)
    setNewName('')
    setOpen(false)
  }

  return (
    <div className="dropdown">
      <button className="layout-btn" onClick={() => setOpen(!open)}>
        <Layers size={13} strokeWidth={1.75} />
        <span>{active}</span>
        <ChevronDown size={13} strokeWidth={2} />
      </button>
      {open && (
        <div className="menu">
          {names.map((name) =>
            editing === name ? (
              <div className="menu-rename" key={name}>
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') setEditing(null)
                  }}
                  onBlur={commitRename}
                />
                <button title="Save" onMouseDown={(e) => e.preventDefault()} onClick={commitRename}>
                  <Check size={14} strokeWidth={2.25} />
                </button>
              </div>
            ) : (
              <button
                key={name}
                className="menu-row"
                onClick={() => {
                  void switchLayout(name)
                  setOpen(false)
                }}
              >
                <span className="menu-check">
                  {name === active && <Check size={14} strokeWidth={2.25} />}
                </span>
                <span className="menu-row-label">{name}</span>
                <span
                  className="menu-row-edit"
                  title="Rename layout"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditing(name)
                    setDraft(name)
                  }}
                >
                  <Pencil size={12} strokeWidth={1.75} />
                </span>
                {names.length > 1 && (
                  <span
                    className="menu-row-del"
                    title="Delete layout"
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteLayout(name)
                    }}
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </span>
                )}
              </button>
            )
          )}
          <div className="menu-sep" />
          <div className="menu-new">
            <input
              value={newName}
              placeholder="New layout…"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <button onClick={create} disabled={!newName.trim()}>
              <Plus size={15} strokeWidth={2.25} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
