import Store from 'electron-store'
import { safeStorage } from 'electron'
import type { ClipItem } from '@shared/types/clipboard'

/**
 * Clipboard history is sensitive, so it's persisted ENCRYPTED (macOS Keychain via
 * safeStorage) in its own store file — never as readable JSON. If encryption isn't
 * available we simply don't persist (history stays in-memory only).
 */
interface Schema {
  /** base64 of safeStorage-encrypted JSON of ClipItem[]. */
  enc: string
}

const store = new Store<Schema>({ name: 'myview-clipboard', defaults: { enc: '' } })

export function loadHistory(): ClipItem[] {
  const enc = store.get('enc')
  if (!enc || !safeStorage.isEncryptionAvailable()) return []
  try {
    const json = safeStorage.decryptString(Buffer.from(enc, 'base64'))
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as ClipItem[]) : []
  } catch {
    return []
  }
}

export function saveHistory(items: ClipItem[]): void {
  if (!safeStorage.isEncryptionAvailable()) return
  try {
    const enc = safeStorage.encryptString(JSON.stringify(items)).toString('base64')
    store.set('enc', enc)
  } catch {
    // Best-effort: a failed encrypt just means this batch isn't persisted.
  }
}

export function clearPersistedHistory(): void {
  store.set('enc', '')
}
