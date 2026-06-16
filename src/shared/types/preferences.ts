/** App-level preferences (not per-widget, not per-service). Persisted in the store. */
export interface Preferences {
  /** Electron accelerator string for the global HUD-summon hotkey. */
  hudHotkey: string
}

export const DEFAULT_PREFERENCES: Preferences = {
  hudHotkey: 'CommandOrControl+Shift+Space'
}
