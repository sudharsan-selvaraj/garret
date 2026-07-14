/** App-level preferences (not per-widget, not per-service). Persisted in the store. */
export interface Preferences {
  /** Electron accelerator string for the global HUD-summon hotkey. */
  hudHotkey: string
  /** Electron accelerator string for the clipboard-manager hotkey. */
  clipboardHotkey: string
  /** Max number of clipboard-history entries to keep. */
  clipboardMaxItems: number
  /** Persist clipboard history (encrypted) across restarts. */
  clipboardPersist: boolean
  /** Skip clipboard items flagged confidential/transient (password managers). */
  clipboardIgnoreConfidential: boolean
  /** Launch Garret automatically at login (packaged app). */
  openAtLogin: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  hudHotkey: 'CommandOrControl+Shift+Space',
  clipboardHotkey: 'Alt+Command+V',
  clipboardMaxItems: 100,
  clipboardPersist: true,
  clipboardIgnoreConfidential: true,
  openAtLogin: false
}
