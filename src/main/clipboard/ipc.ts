import { ipcMain, shell, systemPreferences, Notification } from 'electron'
import { Channels } from '@shared/ipc/channels'
import { pasteToPreviousApp } from '@main/native/macWindow'
import { hideClipboardPicker } from '@main/windows/clipboardPicker'
import { applyToPasteboard, clearClips, deleteClip, getClip, listClipboard } from './manager'

const AX_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

function isAccessibilityTrusted(prompt = false): boolean {
  if (process.platform !== 'darwin') return true
  return systemPreferences.isTrustedAccessibilityClient(prompt)
}

/** Select an item: copy it, dismiss the picker, and paste into the previous app. */
function pasteClip(id: string): void {
  const item = getClip(id)
  hideClipboardPicker()
  if (!item) return
  applyToPasteboard(item)
  if (process.platform !== 'darwin') return

  if (isAccessibilityTrusted(false)) {
    pasteToPreviousApp()
  } else {
    // First time without permission: prompt, and tell the user the manual fallback.
    isAccessibilityTrusted(true)
    new Notification({
      title: 'Copied to clipboard',
      body: 'Grant MyView Accessibility access to paste automatically — or just press ⌘V.'
    }).show()
  }
}

/** Register clipboard-manager IPC handlers. Call once on ready. */
export function registerClipboardHandlers(): void {
  ipcMain.handle(Channels.clipboardList, () => listClipboard())
  ipcMain.on(Channels.clipboardPaste, (_e, id: string) => pasteClip(id))
  ipcMain.on(Channels.clipboardDelete, (_e, id: string) => deleteClip(id))
  ipcMain.on(Channels.clipboardClear, () => clearClips())
  ipcMain.on(Channels.clipboardHide, () => hideClipboardPicker())
  ipcMain.handle(Channels.clipboardAxStatus, () => isAccessibilityTrusted(false))
  ipcMain.on(Channels.clipboardOpenAx, () => {
    isAccessibilityTrusted(true)
    void shell.openExternal(AX_SETTINGS_URL)
  })
}
