import { useState } from 'react'
import { Check, ChevronRight, Copy, Plus, X } from 'lucide-react'
import { defineWidget, type WidgetRenderProps, type WidgetSettingsProps } from '@sdk'

interface Entry {
  id: string
  label: string
  text: string
}

interface Config {
  /** Group name shown in the widget header (e.g. "Git", "Selenium"). */
  title?: string
  entries?: Entry[]
}

/** What actually gets copied (text, or the label if no text was entered). */
function copyValue(e: Entry): string {
  return e.text.trim() || e.label.trim()
}

function SnippetsWidget({ config }: WidgetRenderProps<Config>): JSX.Element {
  const entries = config.entries ?? []
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (e: Entry): Promise<void> => {
    const value = copyValue(e)
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(e.id)
      setTimeout(() => setCopied((c) => (c === e.id ? null : c)), 1200)
    } catch {
      /* clipboard write blocked */
    }
  }

  if (entries.length === 0) {
    return (
      <div className="native-widget snippets snippets-empty">
        No snippets yet. Open settings (⋯) to add some.
      </div>
    )
  }

  return (
    <div className="native-widget snippets">
      <ul className="snippets-list">
        {entries.map((e) => {
          const primary = e.label || e.text
          const sub = e.label && e.text && e.label !== e.text ? e.text : null
          return (
            <li key={e.id}>
              <button className="snippet-row" title={copyValue(e)} onClick={() => copy(e)}>
                <ChevronRight className="snippet-glyph" size={13} strokeWidth={2.5} />
                <span className="snippet-main">
                  <span className="snippet-label">{primary}</span>
                  {sub && <code className="snippet-cmd">{sub}</code>}
                </span>
                <span className={`snippet-copy${copied === e.id ? ' done' : ''}`}>
                  {copied === e.id ? (
                    <Check size={13} strokeWidth={2.5} />
                  ) : (
                    <Copy size={13} strokeWidth={1.75} />
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SnippetsSettings({ config, onChange }: WidgetSettingsProps<Config>): JSX.Element {
  const entries = config.entries ?? []
  const setEntries = (next: Entry[]): void => onChange({ entries: next })
  const add = (): void =>
    setEntries([...entries, { id: crypto.randomUUID(), label: '', text: '' }])
  const update = (id: string, patch: Partial<Entry>): void =>
    setEntries(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const remove = (id: string): void => setEntries(entries.filter((e) => e.id !== id))

  return (
    <div className="snippets-settings">
      <div className="settings-row">
        <label className="settings-row-label">Group name</label>
        <div className="settings-row-control">
          <input
            className="row-input"
            placeholder="e.g. Git, Selenium, Project X"
            value={config.title ?? ''}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
      </div>

      <div className="snippet-edit-list">
        {entries.map((e) => (
          <div className="snippet-edit" key={e.id}>
            <div className="snippet-edit-head">
              <input
                className="row-input"
                placeholder="Label (optional)"
                value={e.label}
                onChange={(ev) => update(e.id, { label: ev.target.value })}
              />
              <button className="snippet-del" title="Remove" onClick={() => remove(e.id)}>
                <X size={14} strokeWidth={2} />
              </button>
            </div>
            <textarea
              className="row-input snippet-edit-text"
              placeholder="Command or text to copy…"
              value={e.text}
              spellCheck={false}
              onChange={(ev) => update(e.id, { text: ev.target.value })}
            />
          </div>
        ))}
      </div>

      <button className="snippet-add" onClick={add}>
        <Plus size={14} strokeWidth={2.25} /> Add snippet
      </button>
    </div>
  )
}

export default defineWidget<Config>({
  manifest: {
    id: 'snippets',
    name: 'Snippets',
    icon: Copy,
    description: 'Click-to-copy text snippets, grouped per tool or project.',
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 2 },
    configSchema: {}
  },
  render: SnippetsWidget,
  Settings: SnippetsSettings
})
