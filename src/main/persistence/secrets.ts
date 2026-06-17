import { safeStorage } from 'electron'
import Store from 'electron-store'

/**
 * Encrypted secret storage. Values are encrypted with the OS keychain via
 * Electron `safeStorage` and only the ciphertext (base64) is written to disk —
 * API tokens / OAuth tokens never sit in plaintext.
 */
interface SecretSchema {
  secrets: Record<string, string>
}

const store = new Store<SecretSchema>({ name: 'garret-secrets', defaults: { secrets: {} } })

export const secrets = {
  available(): boolean {
    return safeStorage.isEncryptionAvailable()
  },
  set(key: string, value: string): void {
    const enc = safeStorage.encryptString(value).toString('base64')
    const all = store.get('secrets')
    all[key] = enc
    store.set('secrets', all)
  },
  get(key: string): string | undefined {
    const enc = store.get('secrets')[key]
    if (!enc) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return undefined
    }
  },
  has(key: string): boolean {
    return Boolean(store.get('secrets')[key])
  },
  delete(key: string): void {
    const all = store.get('secrets')
    delete all[key]
    store.set('secrets', all)
  }
}
