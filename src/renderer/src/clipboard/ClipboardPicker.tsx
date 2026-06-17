import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Files, Image as ImageIcon, Link2, Palette, Search, Type, X } from 'lucide-react'
import type { ClipItem, ClipKind } from '@shared/types/clipboard'

const KIND_ICON: Record<ClipKind, typeof Type> = {
  text: Type,
  link: Link2,
  color: Palette,
  image: ImageIcon,
  files: Files
}

function relativeTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

export function ClipboardPicker(): JSX.Element {
  const [items, setItems] = useState<ClipItem[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [axOk, setAxOk] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const reload = useCallback(async (): Promise<void> => {
    setItems(await window.garret.clipboard.list())
    setAxOk(await window.garret.clipboard.axStatus())
  }, [])

  // Reload on history changes (also fired by main when the picker is summoned).
  useEffect(() => {
    void reload()
    return window.garret.clipboard.onChanged(() => void reload())
  }, [reload])

  // Each time the window is shown (gains focus), start fresh.
  useEffect(() => {
    const onFocus = (): void => {
      setQuery('')
      setSelected(0)
      void reload()
      inputRef.current?.focus()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) =>
      [it.preview, it.text, it.sourceApp, ...(it.files ?? [])]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(q))
    )
  }, [items, query])

  // Keep the selection valid + scrolled into view.
  useEffect(() => {
    if (selected >= filtered.length) setSelected(Math.max(0, filtered.length - 1))
  }, [filtered.length, selected])
  useEffect(() => {
    listRef.current?.querySelector('.clip-row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected, filtered])

  const paste = (it?: ClipItem): void => {
    if (it) window.garret.clipboard.paste(it.id)
  }
  const remove = (it: ClipItem): void => window.garret.clipboard.delete(it.id)

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Escape') {
      e.preventDefault()
      window.garret.clipboard.hide()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(filtered.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      paste(filtered[selected])
    } else if (mod && e.key === 'Backspace') {
      e.preventDefault()
      const it = filtered[selected]
      if (it) remove(it)
    } else if (mod && /^[1-9]$/.test(e.key)) {
      e.preventDefault()
      paste(filtered[Number(e.key) - 1])
    }
  }

  return (
    <div className="clip-window" onKeyDown={onKeyDown}>
      <div className="clip-card">
        <div className="clip-search">
          <Search size={16} strokeWidth={1.75} />
          <input
            ref={inputRef}
            autoFocus
            placeholder="Search clipboard…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
          />
        </div>

        {!axOk && (
          <button className="clip-ax" onClick={() => window.garret.clipboard.openAccessibilitySettings()}>
            Enable Accessibility to paste automatically →
          </button>
        )}

        <div className="clip-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="clip-empty">{items.length ? 'No matches' : 'No clipboard history yet'}</div>
          ) : (
            filtered.map((it, i) => {
              const Icon = KIND_ICON[it.kind]
              return (
                <div
                  key={it.id}
                  className={`clip-row${i === selected ? ' selected' : ''}`}
                  onMouseMove={() => setSelected(i)}
                  onClick={() => paste(it)}
                >
                  <span className="clip-icon">
                    {it.kind === 'image' && it.imageDataUrl ? (
                      <img className="clip-thumb" src={it.imageDataUrl} alt="" />
                    ) : (
                      <Icon size={15} strokeWidth={1.75} />
                    )}
                  </span>
                  <span className="clip-preview">{it.preview}</span>
                  <span className="clip-meta">
                    {it.sourceApp && <span className="clip-app">{it.sourceApp}</span>}
                    <span className="clip-time">{relativeTime(it.createdAt)}</span>
                    {i < 9 && <kbd className="clip-num">⌘{i + 1}</kbd>}
                  </span>
                  <button
                    className="clip-del"
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(it)
                    }}
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="clip-footer">
          <span>
            <kbd>↵</kbd> paste <kbd>⌘⌫</kbd> delete <kbd>esc</kbd> close
          </span>
          {items.length > 0 && (
            <button className="clip-clear" onClick={() => window.garret.clipboard.clear()}>
              Clear all
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
