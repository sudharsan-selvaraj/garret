import { useState } from 'react'
import { Lock, LockOpen, MoreHorizontal, RotateCw, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { PlacedWidget } from '@shared/types/board'
import { registry } from '@renderer/plugins/registry'
import { useBoardStore } from '@renderer/canvas/useBoardStore'
import { useWidgetContext } from '@renderer/widgets/useWidgetContext'
import { WidgetErrorBoundary } from '@renderer/widgets/WidgetErrorBoundary'
import { AutoSettingsForm } from '@renderer/widgets/AutoSettingsForm'
import { WidgetIcon } from '@renderer/widgets/WidgetIcon'
import { ContextMenu, MenuItem, MenuRow, MenuSeparator } from '@renderer/widgets/ContextMenu'

/** Frame + chrome shared by every widget. Looks up the plugin and renders it. */
export function WidgetHost({ widget }: { widget: PlacedWidget }): JSX.Element {
  const plugin = registry.get(widget.pluginId)
  const removeWidget = useBoardStore((s) => s.removeWidget)
  const updateConfig = useBoardStore((s) => s.updateConfig)
  const setOpacity = useBoardStore((s) => s.setOpacity)
  const setLocked = useBoardStore((s) => s.setLocked)

  const [showSettings, setShowSettings] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const ctx = useWidgetContext(widget.id, refreshToken)

  if (!plugin) {
    return (
      <div className="widget widget-error">
        <strong>Unknown widget</strong>
        <code>No plugin registered for “{widget.pluginId}”.</code>
        <button onClick={() => removeWidget(widget.id)}>Remove</button>
      </div>
    )
  }

  const { manifest, render: Render, Settings } = plugin
  const onChange = (patch: Record<string, unknown>): void => updateConfig(widget.id, patch)
  const openMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <div className="widget" style={{ opacity: widget.opacity / 100 }} onContextMenu={openMenu}>
      <header className="widget-header widget-drag">
        <span className="widget-icon">
          <WidgetIcon icon={manifest.icon} size={15} />
        </span>
        <span className="widget-title">{manifest.name}</span>
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

      <div className="widget-body">
        {showSettings ? (
          <div className="widget-settings">
            <div className="settings-scroll">
              {Settings ? (
                <Settings config={widget.config} ctx={ctx} onChange={onChange} />
              ) : (
                <AutoSettingsForm
                  schema={manifest.configSchema}
                  config={widget.config}
                  onChange={onChange}
                />
              )}
            </div>
            <footer className="settings-footer">
              <span className="settings-saved">Changes save automatically</span>
              <button className="settings-done" onClick={() => setShowSettings(false)}>
                Done
              </button>
            </footer>
          </div>
        ) : (
          <WidgetErrorBoundary widgetName={manifest.name}>
            <Render config={widget.config} ctx={ctx} />
          </WidgetErrorBoundary>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem
            icon={<SlidersHorizontal size={15} strokeWidth={1.75} />}
            label="Settings"
            onClick={() => {
              setShowSettings(true)
              setMenu(null)
            }}
          />
          {manifest.capabilities?.refreshable && (
            <MenuItem
              icon={<RotateCw size={15} strokeWidth={1.75} />}
              label="Refresh"
              onClick={() => {
                setRefreshToken((n) => n + 1)
                setMenu(null)
              }}
            />
          )}
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
              min={30}
              max={100}
              step={5}
              value={widget.opacity}
              onChange={(e) => setOpacity(widget.id, Number(e.target.value))}
            />
            <span className="ctx-row-value">{widget.opacity}%</span>
          </MenuRow>
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
