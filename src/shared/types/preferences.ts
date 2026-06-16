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
  /** Notify when a meeting is created or cancelled (needs Google connected). */
  calendarNotifyChanges: boolean
  /** Minutes before a meeting to remind (0 = off). */
  calendarRemindBefore: number
  /** How often (minutes) to check the calendar for changes/reminders. */
  calendarSyncMin: number
}

export const DEFAULT_PREFERENCES: Preferences = {
  hudHotkey: 'CommandOrControl+Shift+Space',
  clipboardHotkey: 'Alt+Command+V',
  clipboardMaxItems: 100,
  clipboardPersist: true,
  clipboardIgnoreConfidential: true,
  calendarNotifyChanges: false,
  calendarRemindBefore: 0,
  calendarSyncMin: 5
}
