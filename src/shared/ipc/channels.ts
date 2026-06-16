import type { BoardState, PlacedWidget } from '../types/board'
import type { WindowMode } from '../types/window'
import type { ServiceStatus } from '../types/services'
import type { PollUpdate, WatchSpec } from '../types/poll'

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
  watchEvent: 'watch:event'
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
}

declare global {
  interface Window {
    myview: MyViewApi
  }
}
