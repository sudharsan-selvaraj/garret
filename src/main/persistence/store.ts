import Store from 'electron-store'
import { DEFAULT_LAYOUT, EMPTY_BOARD, type BoardState, type LayoutsState } from '@shared/types/board'
import { DEFAULT_PREFERENCES, type Preferences } from '@shared/types/preferences'
import type { LayoutsInfo } from '@shared/ipc/channels'

/**
 * On-disk JSON store. `layouts` holds named boards (presets) with the active one;
 * `kv` is the namespaced per-widget key/value space; `preferences` holds app-level
 * settings (e.g. the HUD hotkey).
 */
interface Schema {
  layouts: LayoutsState
  kv: Record<string, unknown>
  preferences: Preferences
}

const store = new Store<Schema>({
  name: 'myview',
  defaults: {
    layouts: { active: DEFAULT_LAYOUT, layouts: { [DEFAULT_LAYOUT]: EMPTY_BOARD } },
    kv: {},
    preferences: DEFAULT_PREFERENCES
  }
})

function state(): LayoutsState {
  return store.get('layouts')
}

function boardOf(s: LayoutsState, name: string): BoardState {
  return s.layouts[name] ?? EMPTY_BOARD
}

export const persistence = {
  loadBoard(): BoardState {
    const s = state()
    return boardOf(s, s.active)
  },
  saveBoard(board: BoardState): void {
    const s = state()
    s.layouts[s.active] = board
    store.set('layouts', s)
  },

  listLayouts(): LayoutsInfo {
    const s = state()
    return { active: s.active, names: Object.keys(s.layouts) }
  },
  switchLayout(name: string): BoardState {
    const s = state()
    if (s.layouts[name]) {
      s.active = name
      store.set('layouts', s)
    }
    return boardOf(state(), state().active)
  },
  createLayout(name: string): BoardState {
    const s = state()
    if (!s.layouts[name]) s.layouts[name] = EMPTY_BOARD
    s.active = name
    store.set('layouts', s)
    return boardOf(s, name)
  },
  renameLayout(from: string, to: string): LayoutsInfo {
    const s = state()
    if (s.layouts[from] && !s.layouts[to] && to.trim()) {
      s.layouts[to] = s.layouts[from]
      delete s.layouts[from]
      if (s.active === from) s.active = to
      store.set('layouts', s)
    }
    return this.listLayouts()
  },
  deleteLayout(name: string): BoardState {
    const s = state()
    // Never delete the last remaining layout.
    if (s.layouts[name] && Object.keys(s.layouts).length > 1) {
      delete s.layouts[name]
      if (s.active === name) s.active = Object.keys(s.layouts)[0]
      store.set('layouts', s)
    }
    return boardOf(state(), state().active)
  },

  /** All placed widgets across every layout (for notification watch registration). */
  allWidgets() {
    const s = state()
    return Object.values(s.layouts).flatMap((b) => b.widgets)
  },

  kvGet(key: string): unknown {
    return store.get('kv')[key]
  },
  kvSet(key: string, value: unknown): void {
    const kv = store.get('kv')
    kv[key] = value
    store.set('kv', kv)
  },

  getPreferences(): Preferences {
    // Merge over defaults so newly-added keys are always present.
    return { ...DEFAULT_PREFERENCES, ...store.get('preferences') }
  },
  setPreferences(patch: Partial<Preferences>): Preferences {
    const next = { ...this.getPreferences(), ...patch }
    store.set('preferences', next)
    return next
  }
}
