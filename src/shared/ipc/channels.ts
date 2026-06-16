import type { BoardState, PlacedWidget } from '../types/board'
import type { WindowMode } from '../types/window'
import type { ServiceStatus } from '../types/services'
import type { PollUpdate, WatchSpec } from '../types/poll'
import type { Preferences } from '../types/preferences'
import type { ClipItem } from '../types/clipboard'

/**
 * The single source of truth for the main ↔ renderer contract.
 * Channel names live here; main registers handlers for them, preload wraps them.
 */
export const Channels = {
  boardLoad: 'board:load',
  boardSave: 'board:save',
  storeGet: 'store:get',
  storeSet: 'store:set',
  setIgnoreMouse: 'window:set-ignore-mouse',
  cursorPos: 'window:cursor-pos',
  layoutsList: 'layouts:list',
  layoutsSwitch: 'layouts:switch',
  layoutsCreate: 'layouts:create',
  layoutsRename: 'layouts:rename',
  layoutsDelete: 'layouts:delete',
  serviceStatus: 'service:status',
  serviceConnect: 'service:connect',
  serviceDisconnect: 'service:disconnect',
  serviceQuery: 'service:query',
  openExternal: 'shell:open-external',
  openPath: 'shell:open-path',
  openInEditor: 'shell:open-in-editor',
  pickDirectory: 'dialog:pick-directory',
  layoutsAllWidgets: 'layouts:all-widgets',
  pollSubscribe: 'poll:subscribe',
  pollUnsubscribe: 'poll:unsubscribe',
  pollRefresh: 'poll:refresh',
  pollUpdate: 'poll:update',
  notifySyncWatches: 'notify:sync-watches',
  watchSubscribe: 'watch:subscribe',
  watchUnsubscribe: 'watch:unsubscribe',
  watchEvent: 'watch:event',
  hudState: 'hud:state',
  hudSet: 'hud:set',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  uiOpenSettings: 'ui:open-settings',
  clipboardList: 'clipboard:list',
  clipboardPaste: 'clipboard:paste',
  clipboardDelete: 'clipboard:delete',
  clipboardClear: 'clipboard:clear',
  clipboardHide: 'clipboard:hide',
  clipboardChanged: 'clipboard:changed',
  clipboardAxStatus: 'clipboard:ax-status',
  clipboardOpenAx: 'clipboard:open-ax'
} as const

/** Options for the file watcher. */
export interface WatchOptions {
  recursive?: boolean
  /** Skip events whose path contains any of these substrings (e.g. '/node_modules/'). */
  ignore?: string[]
  debounceMs?: number
}

/** Snapshot of available layouts and which one is active. */
export interface LayoutsInfo {
  active: string
  names: string[]
}

/**
 * The typed API surface exposed on `window.myview` by the preload bridge.
 * Renderer code programs against this interface, never against raw ipc.
 */
export interface MyViewApi {
  board: {
    /** Load the currently-active layout's board. */
    load(): Promise<BoardState>
    /** Save the currently-active layout's board. */
    save(state: BoardState): Promise<void>
  }
  layouts: {
    list(): Promise<LayoutsInfo>
    /** Switch active layout; returns the newly-active board. */
    switch(name: string): Promise<BoardState>
    /** Create a new (empty) layout and make it active; returns its board. */
    create(name: string): Promise<BoardState>
    rename(from: string, to: string): Promise<LayoutsInfo>
    /** Delete a layout; returns the new active board. */
    delete(name: string): Promise<BoardState>
    /** All placed widgets across every layout (for registering notification watches). */
    allWidgets(): Promise<PlacedWidget[]>
  }
  /** Central poll scheduler — live, coalesced, auto-refreshing query results. */
  poll: {
    subscribe(
      subId: string,
      key: string,
      serviceId: string,
      method: string,
      params: Record<string, unknown>,
      intervalMs: number
    ): Promise<PollUpdate>
    unsubscribe(subId: string): void
    refresh(key: string): void
    onUpdate(cb: (u: PollUpdate) => void): () => void
  }
  /** Background notification watches (registered from the saved board). */
  notify: {
    syncWatches(watches: WatchSpec[]): void
  }
  /** File-system watcher — fires when any watched path changes (debounced). */
  watch: {
    subscribe(watchId: string, paths: string[], opts: WatchOptions): void
    unsubscribe(watchId: string): void
    onEvent(cb: (watchId: string) => void): () => void
  }
  /** HUD mode — summon the widget layer over everything via global hotkey. */
  hud: {
    set(active: boolean): void
    onState(cb: (active: boolean) => void): () => void
  }
  /** App-level preferences (HUD hotkey, …). */
  prefs: {
    get(): Promise<Preferences>
    /** Apply a partial update. `ok:false` means the new hotkey couldn't be registered. */
    set(patch: Partial<Preferences>): Promise<{ ok: boolean; prefs: Preferences }>
  }
  /** UI commands pushed from the main process (e.g. the tray menu). */
  ui: {
    /** Fired when something outside the renderer asks to open Settings (tray → Preferences). */
    onOpenSettings(cb: () => void): () => void
  }
  /** Clipboard manager — history list + paste/delete/clear, used by the picker window. */
  clipboard: {
    list(): Promise<ClipItem[]>
    /** Select an item: copy it, dismiss the picker, and paste into the previous app. */
    paste(id: string): void
    /** Remove a single item from history. */
    delete(id: string): void
    /** Clear all history. */
    clear(): void
    /** Dismiss the picker window (Esc / blur). */
    hide(): void
    /** Whether Accessibility is granted (needed for auto-paste). */
    axStatus(): Promise<boolean>
    /** Open System Settings → Privacy → Accessibility. */
    openAccessibilitySettings(): void
    /** Fired when history changes or the picker is (re)shown — re-fetch the list. */
    onChanged(cb: () => void): () => void
  }
  /**
   * Backend service integrations (Jira, Bitbucket, …). Auth + data live in main;
   * the renderer only ever sees status + query results, never credentials.
   */
  services: {
    status(serviceId: string): Promise<ServiceStatus>
    connect(serviceId: string, creds: Record<string, unknown>): Promise<ServiceStatus>
    disconnect(serviceId: string): Promise<ServiceStatus>
    query<T = unknown>(serviceId: string, method: string, params: Record<string, unknown>): Promise<T>
  }
  /** Open a URL in the user's default browser. */
  openExternal(url: string): void
  /** Reveal/open a local path in Finder. */
  openPath(path: string): void
  /** Open a local path in an editor app ('vscode' | 'cursor' | 'intellij'); falls back to Finder. */
  openInEditor(path: string, editor: string): void
  /** Native folder picker; resolves to the chosen path or null if cancelled. */
  pickDirectory(): Promise<string | null>
  /** Namespaced key/value store for per-widget state (tokens, cursors, cache). */
  store: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
  }
  window: {
    setIgnoreMouseEvents(ignore: boolean): void
    /** Subscribe to main-process cursor polling (window-relative px). Returns an unsubscribe fn. */
    onCursorMove(cb: (pos: { x: number; y: number }) => void): () => void
  }
  platform: NodeJS.Platform
  windowMode: WindowMode
  /** Which UI this window hosts: the widget board, or the clipboard picker. */
  windowRole: WindowRole
}

/** The role a window plays — selects which root UI the renderer mounts. */
export type WindowRole = 'board' | 'clipboard'

declare global {
  interface Window {
    myview: MyViewApi
  }
}
