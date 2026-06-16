import { useEffect, useMemo, useState } from 'react'
import { Wrench } from 'lucide-react'
import { defineWidget, type WidgetRenderProps } from '@sdk'
import { TOOLS, detectTool, type DevTool, type ToolGroup } from './tools'

interface Config {
  /** Last-used tool id, or 'auto'. */
  lastTool?: string
}

const GROUP_ORDER: ToolGroup[] = ['JSON', 'Encoding', 'Token', 'Time', 'Hash', 'Generate']

function DevToolsWidget({ config, ctx }: WidgetRenderProps<Config>): JSX.Element {
  const [input, setInput] = useState('')
  const [toolId, setToolId] = useState(config.lastTool ?? 'auto')
  const [genTick, setGenTick] = useState(0)
  const [out, setOut] = useState('')
  const [err, setErr] = useState<string | null>(null)

  // Resolve the active tool: explicit selection, or auto-detected from the input.
  const active: DevTool | null = useMemo(
    () => (toolId === 'auto' ? detectTool(input) : TOOLS.find((t) => t.id === toolId) ?? null),
    [toolId, input]
  )

  useEffect(() => {
    let cancelled = false
    setErr(null)
    if (!active) {
      setOut('')
      return
    }
    if (!active.generator && !input.trim()) {
      setOut('')
      return
    }
    Promise.resolve()
      .then(() => active.run(active.generator ? '' : input))
      .then((r) => !cancelled && setOut(r))
      .catch((e) => {
        if (cancelled) return
        setOut('')
        setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [active, input, genTick])

  const pickTool = (id: string): void => {
    setToolId(id)
    ctx.updateConfig({ lastTool: id })
  }

  const paste = async (): Promise<void> => {
    try {
      setInput(await navigator.clipboard.readText())
    } catch {
      /* clipboard read blocked — user can paste manually */
    }
  }
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(out)
    } catch {
      /* ignore */
    }
  }

  const grouped = GROUP_ORDER.map((g) => ({ group: g, tools: TOOLS.filter((t) => t.group === g) }))

  return (
    <div className="native-widget devtools">
      <div className="dt-bar">
        <select className="dt-select" value={toolId} onChange={(e) => pickTool(e.target.value)}>
          <option value="auto">Auto-detect</option>
          {grouped.map(({ group, tools }) => (
            <optgroup key={group} label={group}>
              {tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {toolId === 'auto' && (
          <span className="dt-detected">{active ? active.name : 'paste input…'}</span>
        )}
      </div>

      {active?.generator ? (
        <button className="dt-gen" onClick={() => setGenTick((n) => n + 1)}>
          Generate
        </button>
      ) : (
        <textarea
          className="dt-input"
          placeholder="Paste or type input…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      )}

      <div className="dt-actions">
        {!active?.generator && (
          <>
            <button onClick={paste}>Paste</button>
            <button onClick={() => setInput('')} disabled={!input}>
              Clear
            </button>
          </>
        )}
        <span className="dt-spacer" />
        <button onClick={copy} disabled={!out}>
          Copy
        </button>
      </div>

      <pre className={`dt-output${err ? ' dt-error' : ''}`}>
        {err ?? out ?? ''}
      </pre>
    </div>
  )
}

export default defineWidget<Config>({
  manifest: {
    id: 'dev-tools',
    name: 'Dev Tools',
    icon: Wrench,
    description: 'Offline JSON, Base64, JWT, URL, timestamp & hash utilities.',
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 3 },
    configSchema: {}
  },
  render: DevToolsWidget
})
