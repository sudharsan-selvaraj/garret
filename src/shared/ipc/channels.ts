import type { BoardState, PlacedWidget } from '../types/board'
import type { WindowMode } from '../types/window'
import type { ServiceStatus } from '../types/services'
import type { PollUpdate, WatchSpec } from '../types/poll'
import type { Preferences } from '../types/preferences'
import type { ClipItem } from '../types/clipboard'
import type {
  ExtRuntimeInfo,
  ExtInstallPlan,
  InstalledExtension as ExtInstalled,
  MarketplaceEntry,
  InstalledPack
} from '../types/ext'
import type { WatchOptions } from 'garret-core'

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
  displaysChanged: 'window:displays-changed', // main → renderer: spanning board re-fit (new bounds)
  layoutsList: 'layouts:list',
  layoutsSwitch: 'layouts:switch',
  layoutsCreate: 'layouts:create',
  layoutsRename: 'layouts:rename',
  layoutsDelete: 'layouts:delete',
  layoutsAddWidget: 'layouts:add-widget',
  pluginsListExternal: 'plugins:list-external',
  pluginsFetch: 'plugins:fetch',
  pluginsOpenExternal: 'plugins:open-external',
  // --- unified extension system (garret-sdk) ---
  extList: 'ext:list', // board loader → { preloadUrl, extensions: ExtRuntimeInfo[] }
  extBind: 'ext:bind', // guest self-binds: (extensionId, instanceId) → { ok, hasHost, props }
  extUnbind: 'ext:unbind', // (wcId)
  extHostSend: 'ext:host-send', // renderer → main: a WireMessage for the bound host
  extHostFrame: 'ext:host-frame', // main → renderer: a WireMessage from the host
  extPlatform: 'ext:platform', // (domain, op, args) → broker
  extActive: 'ext:active', // main → renderer: board active/idle
  extConfig: 'ext:config', // (op, value?, replace?) → per-placement settings (instance from binding)
  extConfigChange: 'ext:config-change', // main → guest: config changed
  extInstallPlan: 'ext:install-plan',
  extInstallFromFile: 'ext:install-from-file',
  extInstallCommit: 'ext:install-commit',
  extInstallCleanup: 'ext:install-cleanup',
  extListInstalled: 'ext:list-installed',
  extSetEnabled: 'ext:set-enabled',
  extRemove: 'ext:remove',
  extMarketplace: 'ext:marketplace', // () → MarketplaceEntry[] (fetch the GitHub registry index)
  extInstallUrl: 'ext:install-url', // (url) → install a marketplace pack's .garret (one-click)
  extPacks: 'ext:packs', // () → InstalledPack[] (per-pack + per-widget detail, for the settings sidebar)
  extSettingsGet: 'ext:settings-get', // (fullId) → the widget's stored settings values
  extSettingsSet: 'ext:settings-set', // (fullId, patch) → merge settings into the widget's store
  extSecretSet: 'ext:secret-set', // (fullId, key, value) → a type:"secret" field → encrypted store
  extSecretKeys: 'ext:secret-keys', // (fullId) → names of secrets that are set (never the values)
  extSharedGet: 'ext:shared-get', // (packId) → the pack's shared (non-secret) settings values
  extSharedSet: 'ext:shared-set', // (packId, patch) → merge into the pack's shared store
  extSharedSecretSet: 'ext:shared-secret-set', // (packId, key, value) → pack-shared encrypted store
  extSharedSecretKeys: 'ext:shared-secret-keys', // (packId) → names of shared secrets that are set
  // Generic widget-command bus: a widget declares frame ⋯-menu actions; the frame renders them and
  // dispatches the chosen one back. One mechanism for settings/refresh/anything — no per-action wiring.
  extSetCommands: 'ext:set-commands', // guest → main: declare this placement's menu commands
  extWidgetCommands: 'ext:widget-commands', // main → board renderer: (instanceId, commands[])
  extRunCommand: 'ext:run-command', // renderer → main: (instanceId, commandId) — user picked a command
  extCommand: 'ext:command', // main → guest: (commandId) run it
  extSetTitle: 'ext:set-title', // guest → main: set this placement's frame title
  extWidgetTitle: 'ext:widget-title', // main → board renderer: (instanceId, title) apply to board config
  extOpenFile: 'ext:open-file', // main → renderer: a .garret was opened from Finder
  extFlushOpenFiles: 'ext:flush-open-files', // renderer → main: drain opens queued before mount
  // --- floating surface windows (docs/floating-surface-windows.md) ---
  extSurfaceOpen: 'ext:surface-open', // guest → main: open a same-package surface as a floating window
  extSurfaceClose: 'ext:surface-close', // guest → main: (instanceId)
  extSurfaceFocus: 'ext:surface-focus', // guest → main: (instanceId)
  extSurfaceInit: 'ext:surface-init', // surface window root → main: () → render config (by e.sender.id)
  extSurfaceClosed: 'ext:surface-closed', // main → opener: (instanceId) a spawned window closed
  extInstanceGone: 'ext:instance-gone', // board → main: (extId, instanceId) a placement was removed
  extSurfaceSetAspect: 'ext:surface-set-aspect', // surface guest → main: set its OWN window aspect ratio
  extSurfaceResize: 'ext:surface-resize', // surface guest → main: resize its OWN window (px)
  extSurfaceSelfClose: 'ext:surface-self-close', // surface guest → main: close its OWN window (frameless chrome)
  // --- WebContentsView geometry spike (dev-only, throwaway) ---
  wcvSpikeEnabled: 'wcv-spike:enabled',
  wcvSpikeCreate: 'wcv-spike:create',
  wcvSpikeBounds: 'wcv-spike:bounds',
  wcvSpikeVisible: 'wcv-spike:visible',
  wcvSpikeDestroy: 'wcv-spike:destroy',
  serviceStatus: 'service:status',
  serviceConnect: 'service:connect',
  serviceDisconnect: 'service:disconnect',
  serviceQuery: 'service:query',
  openExternal: 'shell:open-external',
  openPath: 'shell:open-path',
  openInEditor: 'shell:open-in-editor',
  pickDirectory: 'dialog:pick-directory',
  pickGarretFile: 'dialog:pick-garret',
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

/** Options for the file watcher (single source: garret-core). */
export type { WatchOptions }

/** Snapshot of available layouts and which one is active. */
export interface LayoutsInfo {
  active: string
  names: string[]
}

/** Render config for a floating surface window's root (from `ext.surfaceInit`). */
export interface SurfaceInit {
  extId: string
  instanceId: string
  /** garret://<extId>/~<surfaceId>/ */
  uiUrl: string
  /** file:// URL of the extBridge preload for the guest webview. */
  preloadUrl: string
  title: string
  /** false → the root draws a draggable titlebar (a webview guest can't set `-webkit-app-region`). */
  frame: boolean
}

/**
 * The typed API surface exposed on `window.garret` by the preload bridge.
 * Renderer code programs against this interface, never against raw ipc.
 */
export interface GarretApi {
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
    /** Append a widget to another (non-active) layout — for copy/move between layouts. */
    addWidget(name: string, widget: PlacedWidget): Promise<void>
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
  /** Dev-tier external widgets loaded from the `external-widgets/` folder. */
  plugins: {
    listExternal(): Promise<{ name: string; source: string }[]>
    /**
     * Host-mediated HTTP (no CORS) — the network chokepoint for widgets. Pass
     * `allowedHosts` (the sandbox path) to gate the request to a widget's declared hosts
     * + the resolved-IP rebind guard; omit it only for the trusted dev tier.
     */
    fetch(
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string },
      opts?: { allowedHosts?: string[] }
    ): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>
    /** Open a URL in the browser AFTER a native confirm dialog; resolves true if opened. */
    openExternalConfirmed(url: string): Promise<boolean>
  }
  /** Unified extension system (garret-sdk). Board-side API; guests use window.__garret (extBridge). */
  ext: {
    list(): Promise<{ preloadUrl: string; extensions: ExtRuntimeInfo[] }>
    planInstall(dir: string): Promise<ExtInstallPlan>
    planInstallFromFile(garretPath: string): Promise<ExtInstallPlan>
    commitInstall(plan: ExtInstallPlan): Promise<{ ok: boolean; error?: string }>
    cleanupInstall(dir: string): Promise<void>
    listInstalled(): Promise<ExtInstalled[]>
    setEnabled(id: string, on: boolean): Promise<{ ok: boolean; error?: string }>
    remove(id: string): Promise<void>
    /** Fetch the marketplace registry index (curated GitHub repo). */
    marketplace(): Promise<MarketplaceEntry[]>
    /** One-click install a marketplace pack by its prebuilt-.garret URL. */
    installUrl(url: string): Promise<{ ok: boolean; error?: string }>
    /** Installed packs with per-widget detail + settings schemas (for the settings sidebar). */
    packs(): Promise<InstalledPack[]>
    /** Read / merge a widget's declarative settings values (keyed by `packId/widgetId`). */
    settingsGet(fullId: string): Promise<Record<string, unknown>>
    settingsSet(fullId: string, patch: Record<string, unknown>): Promise<void>
    /** Write a `type:"secret"` field to the widget's encrypted store; list which secrets are set. */
    secretSet(fullId: string, key: string, value: string): Promise<void>
    secretKeys(fullId: string): Promise<string[]>
    /** Pack-shared settings (the `shared` schema): read/merge values + write/list secret keys. */
    sharedGet(packId: string): Promise<Record<string, unknown>>
    sharedSet(packId: string, patch: Record<string, unknown>): Promise<void>
    sharedSecretSet(packId: string, key: string, value: string): Promise<void>
    sharedSecretKeys(packId: string): Promise<string[]>
    /** User picked a widget-declared command from the frame ⋯ menu → dispatch to the guest. */
    runCommand(instanceId: string, commandId: string): Promise<void>
    /** main → board renderer: a gx: widget's declared ⋯-menu commands (id + label). */
    onWidgetCommands(cb: (instanceId: string, commands: { id: string; label: string }[]) => void): () => void
    /** main → board renderer: apply a gx: widget's self-set title to the board config. */
    onWidgetTitle(cb: (instanceId: string, title: string) => void): () => void
    /** A `.garret` was opened from Finder (double-click / Open With) — deliver its path. */
    onOpenFile(cb: (path: string) => void): () => void
    /** Ask main to drain any `.garret` opens queued before the renderer's listener mounted. */
    flushOpenFiles(): void
    /** A floating surface window's root fetches its render config (keyed on its own wcId in main). */
    surfaceInit(): Promise<SurfaceInit | null>
    /** Signal that a board placement was genuinely removed → close-with-opener (its surfaces close). */
    instanceGone(extId: string, instanceId: string): void
  }
  /** DEV-ONLY throwaway: WebContentsView geometry spike (gated by GARRET_WCV_SPIKE=1). */
  wcvSpike: {
    enabled(): Promise<boolean>
    create(id: string): Promise<void>
    setBounds(id: string, rect: { x: number; y: number; width: number; height: number }): Promise<void>
    setVisible(id: string, visible: boolean): Promise<void>
    destroy(id: string): Promise<void>
  }
  /** Open a URL in the user's default browser. */
  openExternal(url: string): void
  /** Reveal/open a local path in Finder. */
  openPath(path: string): void
  /** Open a local path in an editor app ('vscode' | 'cursor' | 'intellij'); falls back to Finder. */
  openInEditor(path: string, editor: string): void
  /** Native folder picker; resolves to the chosen path or null if cancelled. */
  pickDirectory(): Promise<string | null>
  /** Native file picker filtered to `.garret`; resolves to the path or null if cancelled. */
  pickGarretFile(): Promise<string | null>
  /** Namespaced key/value store for per-widget state (tokens, cursors, cache). */
  store: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
  }
  /** The spanning board re-fit after a display change; payload is the new union bounds. */
  onDisplaysChanged(cb: (bounds: { x: number; y: number; width: number; height: number }) => void): () => void
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
export type WindowRole = 'board' | 'clipboard' | 'surface'

declare global {
  interface Window {
    garret: GarretApi
  }
}
