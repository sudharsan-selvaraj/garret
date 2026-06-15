/**
 * Domain types for a board of freely-positioned widgets. Pure data — no React,
 * no Electron. Shared by main (persistence) and renderer (canvas).
 */

/** A widget placed freely on the desktop: plugin + config + geometry + view state. */
export interface PlacedWidget<C = Record<string, unknown>> {
  /** Stable instance id (uuid). */
  id: string
  /** Which registered plugin renders this widget. */
  pluginId: string
  /** Instance-specific configuration (validated against the plugin schema). */
  config: C
  /** Absolute position/size on the desktop, in CSS pixels. */
  x: number
  y: number
  width: number
  height: number
  /** Per-widget opacity, 0–100. */
  opacity: number
  /** When locked, the widget can't be dragged or resized. */
  locked: boolean
  /** Optional surface tint (hex, e.g. "#0a84ff"); falls back to the default panel. */
  color?: string
}

/** A single board = the set of placed widgets for one layout. */
export interface BoardState {
  widgets: PlacedWidget[]
}

export const EMPTY_BOARD: BoardState = { widgets: [] }

/** Named layouts (presets), with the currently-active one. */
export interface LayoutsState {
  active: string
  layouts: Record<string, BoardState>
}

export const DEFAULT_LAYOUT = 'Default'
