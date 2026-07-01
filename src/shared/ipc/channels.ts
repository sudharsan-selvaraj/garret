import type { BoardState, PlacedWidget } from '../types/board'
import type { WindowMode } from '../types/window'
import type { ServiceStatus } from '../types/services'
import type { PollUpdate, WatchSpec } from '../types/poll'
import type { Preferences } from '../types/preferences'
import type { ClipItem } from '../types/clipboard'
import type { InstallPlan, InstalledWidget } from '../types/sandbox'
import type { NativeInstallPlan, InstalledExtension } from '../types/native'
import type { WatchOptions } from 'garret-core'

/** A native extension as the renderer needs it to render + place it. */
export interface NativeExtensionInfo {
  id: string
  name: string
  /** file:// URL of the extension's UI entry (index.html). */
  uiUrl: string
  defaultSize?: { w: number; h: number }
}

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
  layoutsAddWidget: 'layouts:add-widget',
  pluginsListExternal: 'plugins:list-external',
  pluginsFetch: 'plugins:fetch',
  pluginsOpenExternal: 'plugins:open-external',
  sandboxPrepare: 'sandbox:prepare',
  sandboxList: 'sandbox:list',
  sandboxInstallPlan: 'sandbox:install-plan',
  sandboxInstallFromFile: 'sandbox:install-from-file',
  sandboxInstallCleanup: 'sandbox:install-cleanup',
  sandboxInstallCommit: 'sandbox:install-commit',
  sandboxRemove: 'sandbox:remove',
  sandboxSetEnabled: 'sandbox:set-enabled',
  sandboxRecordUsage: 'sandbox:record-usage',
  sandboxPreviewDataUrl: 'sandbox:preview-data-url',
  sandboxOpenFile: 'sandbox:open-file',
  sandboxFlushOpenFiles: 'sandbox:flush-open-files',
  nativeExtList: 'native-ext:list',
  nativeExtStart: 'native-ext:start',
  nativeExtStop: 'native-ext:stop',
  nativeExtRequest: 'native-ext:request',
  nativeExtEvent: 'native-ext:event',
  nativeExtInstallPlan: 'native-ext:install-plan',
  nativeExtInstallFromFile: 'native-ext:install-from-file',
  nativeExtInstallCleanup: 'native-ext:install-cleanup',
  nativeExtInstallCommit: 'native-ext:install-commit',
  nativeExtListInstalled: 'native-ext:list-installed',
  nativeExtSetEnabled: 'native-ext:set-enabled',
  nativeExtRemove: 'native-ext:remove',
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
  /** Sandboxed (third-party) widget runtime + install lifecycle. */
  sandbox: {
    /** Configure a widget's partition session guards BEFORE its webview navigates. */
    prepare(partition: string): Promise<{ preloadUrl: string }>
    /** Installed sandboxed widgets (display manifest + the authoritative consented perms). */
    list(): Promise<InstalledWidget[]>
    /** Validate a source folder + produce a consent plan (writes nothing). */
    planInstall(srcDir: string): Promise<InstallPlan>
    /** Extract a `.garret` file to a temp dir + produce a consent plan (staged). */
    installFromFile(garretPath: string): Promise<InstallPlan>
    /** Remove a `.garret` staging temp dir after confirm/cancel (no-op for folder installs). */
    installCleanup(source: string): void
    /** Commit a plan the user confirmed (safe copy + install record). */
    commitInstall(plan: InstallPlan): Promise<{ ok: boolean; error?: string }>
    /** Uninstall a widget (deletes its dir + record). */
    remove(id: string): Promise<void>
    /** Enable/disable without uninstalling. */
    setEnabled(id: string, enabled: boolean): Promise<void>
    /** Record capabilities a running widget attempted-but-was-denied (disclosure). */
    recordUsage(id: string, attemptedBlocked: string[]): void
    /** Data: URL of a widget's manifest `preview` image for the gallery (null if none). */
    previewDataUrl(id: string): Promise<string | null>
    /** A `.garret` was opened from Finder (double-click / Open With) — deliver its path. */
    onOpenFile(cb: (path: string) => void): () => void
    /** Ask main to drain any `.garret` opens queued before the renderer's listener mounted. */
    flushOpenFiles(): void
  }
  /** Native extensions (full-access, trusted, raw-Node host). See docs/native-extensions-design.md. */
  nativeExt: {
    /** Installed native extensions + the shared UI-bridge preload URL. */
    list(): Promise<{ preloadUrl: string; extensions: NativeExtensionInfo[] }>
    /** Launch the raw-Node host for a placed instance, bound to its UI webview's webContents id. */
    start(extensionId: string, webContentsId: number): Promise<{ ok: boolean; error?: string }>
    /** Tear down the host for a UI webview (on unmount). */
    stop(webContentsId: number): void
    /** Validate a source folder for install (writes nothing); returns the plan for consent. */
    planInstall(srcDir: string): Promise<NativeInstallPlan>
    /** Validate + stage a `.garret` extension file; returns the plan (staged temp in `source`). */
    planInstallFromFile(garretPath: string): Promise<NativeInstallPlan>
    /** Discard a staged `.garret` temp dir (on cancel). */
    cleanupInstall(dir: string): Promise<void>
    /** Commit a confirmed install. Installs DISABLED — the user enables it separately. */
    commitInstall(plan: NativeInstallPlan): Promise<{ ok: boolean; error?: string }>
    /** All installed native extensions (for the manager), with tamper/integrity flags. */
    listInstalled(): Promise<InstalledExtension[]>
    /** Enable/disable. Renderer MUST show the full-access consent before enabling. */
    setEnabled(id: string, on: boolean): Promise<{ ok: boolean; error?: string }>
    /** Uninstall (removes files + record). */
    remove(id: string): Promise<void>
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
    garret: GarretApi
  }
}
