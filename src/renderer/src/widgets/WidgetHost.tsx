import { useState, type CSSProperties } from 'react'
import {
  Circle,
  Copy,
  CornerUpRight,
  Lock,
  LockOpen,
  MoreHorizontal,
  RotateCw,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import type { PlacedWidget } from '@shared/types/board'
import { registry } from '@renderer/plugins/registry'
import { useBoardStore } from '@renderer/canvas/useBoardStore'
import { WidgetErrorBoundary } from '@renderer/widgets/WidgetErrorBoundary'
import { WidgetIcon } from '@renderer/widgets/WidgetIcon'
import { ContextMenu, MenuItem, MenuRow, MenuSeparator } from '@renderer/widgets/ContextMenu'
import { useWidgetMenus, type WidgetCommand } from '@renderer/ext/widgetMenus'

const EMPTY_COMMANDS: WidgetCommand[] = []

/** Default ⋯-menu icons for common declared-command ids; unknown ids fall back to a neutral icon.
 *  A widget just declares {id,label}; the frame owns the iconography (design-system convention). */
function commandIcon(id: string): JSX.Element {
  const Icon = id === 'refresh' ? RotateCw : id === 'settings' ? SlidersHorizontal : Circle
  return <Icon size={15} strokeWidth={1.75} />
}

/** Preset tints for the widget color picker (macOS system palette). */
const COLOR_PRESETS = [
  '#0a84ff',
  '#5e5ce6',
  '#bf5af2',
  '#ff375f',
  '#ff453a',
  '#ff9f0a',
  '#ffd60a',
  '#30d158',
  '#40c8e0',
  '#8e8e93'
]

function rgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]
}
function hexToRgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
/** Perceived luminance > threshold ⇒ the tint is light and needs dark text. */
function isLight(hex: string): boolean {
  const [r, g, b] = rgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62
}

/** Frame + chrome shared by every widget. Looks up the plugin and renders it. */
export function WidgetHost({ widget }: { widget: PlacedWidget }): JSX.Element {
  const plugin = registry.get(widget.pluginId)
  const removeWidget = useBoardStore((s) => s.removeWidget)
  const setOpacity = useBoardStore((s) => s.setOpacity)
  const setLocked = useBoardStore((s) => s.setLocked)
  const setColor = useBoardStore((s) => s.setColor)
  const layoutNames = useBoardStore((s) => s.layoutNames)
  const activeLayout = useBoardStore((s) => s.activeLayout)
  const copyWidgetTo = useBoardStore((s) => s.copyWidgetTo)
  const moveWidgetTo = useBoardStore((s) => s.moveWidgetTo)

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const ctx = { instanceId: widget.id }
  // A sandboxed pack declares its ⋯-menu commands (g.setCommands); the frame renders them generically.
  const extCommands = useWidgetMenus((s) => s.byId[widget.id]) ?? EMPTY_COMMANDS

  if (!plugin) {
    return (
      <div className="widget widget-error">
        <strong>Widget unavailable</strong>
        <code>Removed or disabled — manage it in Settings → Widgets.</code>
        <button onClick={() => removeWidget(widget.id)}>Remove</button>
      </div>
    )
  }

  const { manifest, render: Render } = plugin
  const openMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  // "Opacity" drives the BACKGROUND alpha only (100 = opaque), so reducing it lets
  // the wallpaper show through while text/content stay fully legible.
  const bgAlpha = (widget.opacity ?? 100) / 100
  const lightTint = widget.color ? isLight(widget.color) : false
  const style: CSSProperties = {
    background: widget.color ? hexToRgba(widget.color, bgAlpha) : `rgba(34, 34, 36, ${bgAlpha})`
  }

  // Headless: no header chrome. The whole card becomes the drag handle; settings live in the menu.
  const headless = manifest.capabilities?.headless ?? false
  const bodyDrag = headless ? ' widget-drag' : ''

  // Per-instance title override (e.g. name a Snippets widget "Git"); falls back
  // to the plugin's name. Any widget can set config.title.
  const customTitle = typeof widget.config.title === 'string' ? widget.config.title.trim() : ''
  const title = customTitle || manifest.name

  return (
    <div
      className={`widget${lightTint ? ' widget--light' : ''}${headless ? ' widget--headless' : ''}`}
      style={style}
      onContextMenu={openMenu}
    >
      {!headless && (
        <header className="widget-header widget-drag">
          <span className="widget-icon">
            <WidgetIcon icon={manifest.icon} size={15} />
          </span>
          <span className="widget-title">{title}</span>
          {widget.locked && (
            <span className="widget-lock" title="Locked">
              <Lock size={12} strokeWidth={2} />
            </span>
          )}
          <div className="widget-actions" onMouseDown={(e) => e.stopPropagation()}>
            <button
              title="Options"
              className={menu ? 'active' : ''}
              onClick={(e) => setMenu({ x: e.currentTarget.getBoundingClientRect().right, y: e.currentTarget.getBoundingClientRect().bottom + 4 })}
            >
              <MoreHorizontal size={16} strokeWidth={1.75} />
            </button>
          </div>
        </header>
      )}

      <div className={`widget-body${bodyDrag}`}>
        <WidgetErrorBoundary widgetName={manifest.name}>
          <Render config={widget.config} ctx={ctx} />
        </WidgetErrorBoundary>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {/* A pack renders in a sandboxed webview, so it DECLARES its ⋯-menu commands (settings,
              refresh, whatever it wants) via g.setCommands; the frame renders them + dispatches back. */}
          {extCommands.map((c) => (
            <MenuItem
              key={c.id}
              icon={commandIcon(c.id)}
              label={c.label}
              onClick={() => {
                void window.garret.ext.runCommand(ctx.instanceId, c.id)
                setMenu(null)
              }}
            />
          ))}
          <MenuSeparator />
          <MenuItem
            icon={
              widget.locked ? (
                <LockOpen size={15} strokeWidth={1.75} />
              ) : (
                <Lock size={15} strokeWidth={1.75} />
              )
            }
            label={widget.locked ? 'Unlock position' : 'Lock position'}
            onClick={() => {
              setLocked(widget.id, !widget.locked)
              setMenu(null)
            }}
          />
          <MenuRow>
            <span className="ctx-row-label">Opacity</span>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={widget.opacity}
              onChange={(e) => setOpacity(widget.id, Number(e.target.value))}
            />
            <span className="ctx-row-value">{widget.opacity}%</span>
          </MenuRow>
          <div className="ctx-color">
            <span className="ctx-row-label">Color</span>
            <div className="ctx-swatches">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  className={`swatch${widget.color === c ? ' active' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => setColor(widget.id, c)}
                />
              ))}
              <label className="swatch swatch-custom" title="Custom color">
                <input
                  type="color"
                  value={widget.color ?? '#222224'}
                  onChange={(e) => setColor(widget.id, e.target.value)}
                />
              </label>
              <button
                className="swatch swatch-reset"
                title="Default"
                onClick={() => setColor(widget.id, undefined)}
              >
                ×
              </button>
            </div>
          </div>
          {layoutNames.filter((n) => n !== activeLayout).length > 0 && (
            <>
              <MenuSeparator />
              <div className="ctx-section">Send to layout</div>
              {layoutNames
                .filter((n) => n !== activeLayout)
                .map((name) => (
                  <div className="ctx-move" key={name}>
                    <span className="ctx-move-name">{name}</span>
                    <button
                      className="ctx-move-btn"
                      title={`Move to ${name}`}
                      onClick={() => {
                        void moveWidgetTo(name, widget)
                        setMenu(null)
                      }}
                    >
                      <CornerUpRight size={14} strokeWidth={1.75} />
                    </button>
                    <button
                      className="ctx-move-btn"
                      title={`Copy to ${name}`}
                      onClick={() => {
                        void copyWidgetTo(name, widget)
                        setMenu(null)
                      }}
                    >
                      <Copy size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                ))}
            </>
          )}
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 size={15} strokeWidth={1.75} />}
            label="Remove widget"
            danger
            onClick={() => {
              removeWidget(widget.id)
              setMenu(null)
            }}
          />
        </ContextMenu>
      )}
    </div>
  )
}
