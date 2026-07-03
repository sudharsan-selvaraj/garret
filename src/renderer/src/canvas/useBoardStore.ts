import { create } from 'zustand'
import type { BoardState, PlacedWidget } from '@shared/types/board'
import { defaultConfig } from '@sdk'
import { registry } from '@renderer/plugins/registry'

interface Frame {
  x: number
  y: number
  width: number
  height: number
}

interface BoardStore {
  widgets: PlacedWidget[]
  ready: boolean
  activeLayout: string
  layoutNames: string[]

  hydrate: () => Promise<void>
  addWidget: (pluginId: string) => void
  removeWidget: (id: string) => void
  updateConfig: (id: string, patch: Record<string, unknown>) => void
  updateFrame: (id: string, frame: Frame) => void
  /** Pull any widget now outside the board (e.g. a display was unplugged) back on-screen. */
  clampToBounds: (width: number, height: number) => void
  setOpacity: (id: string, opacity: number) => void
  setLocked: (id: string, locked: boolean) => void
  setColor: (id: string, color: string | undefined) => void

  refreshLayouts: () => Promise<void>
  switchLayout: (name: string) => Promise<void>
  createLayout: (name: string) => Promise<void>
  renameLayout: (from: string, to: string) => Promise<void>
  deleteLayout: (name: string) => Promise<void>
  copyWidgetTo: (target: string, widget: PlacedWidget) => Promise<void>
  moveWidgetTo: (target: string, widget: PlacedWidget) => Promise<void>
}

function persist(widgets: PlacedWidget[]): void {
  const board: BoardState = { widgets }
  void window.garret.board.save(board)
}

export const useBoardStore = create<BoardStore>((set, get) => {
  const apply = (widgets: PlacedWidget[]): void => {
    set({ widgets })
    persist(widgets)
  }
  const mut = (id: string, fn: (w: PlacedWidget) => PlacedWidget): void =>
    apply(get().widgets.map((w) => (w.id === id ? fn(w) : w)))

  return {
    widgets: [],
    ready: false,
    activeLayout: '',
    layoutNames: [],

    hydrate: async () => {
      const [board, info] = await Promise.all([
        window.garret.board.load(),
        window.garret.layouts.list()
      ])
      set({
        widgets: board.widgets,
        activeLayout: info.active,
        layoutNames: info.names,
        ready: true
      })
    },

    addWidget: (pluginId) => {
      const plugin = registry.get(pluginId)
      if (!plugin) return
      const { defaultSize, minSize } = plugin.manifest
      const n = get().widgets.length
      const widget: PlacedWidget = {
        id: crypto.randomUUID(),
        pluginId,
        config: defaultConfig(plugin.manifest.configSchema),
        x: 48 + (n % 6) * 32,
        y: 96 + (n % 6) * 32,
        width: Math.max((minSize?.w ?? 2) * 70, defaultSize.w * 70),
        height: Math.max((minSize?.h ?? 2) * 56, defaultSize.h * 56),
        opacity: 100,
        locked: false
      }
      apply([...get().widgets, widget])
    },

    removeWidget: (id) => {
      // Close-with-opener (B3): a GENUINE removal (not a layout switch / reload / unmount) is the
      // only place we signal main to close this placement's floating surfaces. Extension disable /
      // uninstall is handled separately by main's revokeExt → closeSurfacesForExt.
      const w = get().widgets.find((x) => x.id === id)
      if (w?.pluginId.startsWith('gx:')) {
        window.garret.ext.instanceGone(w.pluginId.slice('gx:'.length), id)
      }
      apply(get().widgets.filter((x) => x.id !== id))
    },

    updateConfig: (id, patch) =>
      mut(id, (w) => ({ ...w, config: { ...w.config, ...patch } })),

    updateFrame: (id, frame) => mut(id, (w) => ({ ...w, ...frame })),

    clampToBounds: (width, height) => {
      const clamped = get().widgets.map((w) => ({
        ...w,
        x: Math.max(0, Math.min(w.x, Math.max(0, width - w.width))),
        y: Math.max(0, Math.min(w.y, Math.max(0, height - w.height)))
      }))
      apply(clamped)
    },

    setOpacity: (id, opacity) => mut(id, (w) => ({ ...w, opacity })),

    setLocked: (id, locked) => mut(id, (w) => ({ ...w, locked })),

    setColor: (id, color) => mut(id, (w) => ({ ...w, color })),

    refreshLayouts: async () => {
      const info = await window.garret.layouts.list()
      set({ activeLayout: info.active, layoutNames: info.names })
    },

    switchLayout: async (name) => {
      const board = await window.garret.layouts.switch(name)
      set({ widgets: board.widgets, activeLayout: name })
    },

    createLayout: async (name) => {
      const board = await window.garret.layouts.create(name)
      const info = await window.garret.layouts.list()
      set({ widgets: board.widgets, activeLayout: info.active, layoutNames: info.names })
    },

    renameLayout: async (from, to) => {
      const info = await window.garret.layouts.rename(from, to)
      set({ activeLayout: info.active, layoutNames: info.names })
    },

    deleteLayout: async (name) => {
      const board = await window.garret.layouts.delete(name)
      const info = await window.garret.layouts.list()
      set({ widgets: board.widgets, activeLayout: info.active, layoutNames: info.names })
    },

    // Clone (new id) into another layout's board. The target is never the active
    // layout (the menu only offers others), so the local board is untouched.
    copyWidgetTo: async (target, widget) => {
      await window.garret.layouts.addWidget(target, { ...widget, id: crypto.randomUUID() })
    },

    moveWidgetTo: async (target, widget) => {
      await window.garret.layouts.addWidget(target, { ...widget, id: crypto.randomUUID() })
      get().removeWidget(widget.id)
    }
  }
})
