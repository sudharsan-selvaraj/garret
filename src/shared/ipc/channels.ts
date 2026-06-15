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
  layoutsAllWidgets: 'layouts:all-widgets',
  pollSubscribe: 'poll:subscribe',
  pollUnsubscribe: 'poll:unsubscribe',
  pollRefresh: 'poll:refresh',
  pollUpdate: 'poll:update',
  notifySyncWatches: 'notify:sync-watches'
} as const

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
