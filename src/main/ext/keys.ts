import { safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { secrets as secretStore } from '@main/persistence/secrets'

/**
 * Key material for the unified extension system, all held in the OS-encrypted secret store
 * (`safeStorage`). Two kinds:
 *  - ONE app-wide HMAC key that signs install records (anti-local-tamper — see install.ts).
 *  - a PER-EXTENSION AES key that backs the SDK's `ctx.secrets`, injected into the host env as
 *    GARRET_EXT_SECRET_KEY.
 *
 * If safeStorage is unavailable we return null and the caller FAILS CLOSED (never a plaintext key —
 * that's zero mitigation against the file-write attacker these guard against).
 */

const RECORD_KEY = 'ext.recordMacKey'

export function recordMacKey(): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  let hex = secretStore.get(RECORD_KEY)
  if (!hex) {
    hex = randomBytes(32).toString('hex')
    secretStore.set(RECORD_KEY, hex)
  }
  return Buffer.from(hex, 'hex')
}

const extSecretName = (id: string): string => `ext.secretKey.${id}`

/** Per-extension AES-256 key (hex) for the host's `ctx.secrets`. Created on demand. */
export function extSecretKeyHex(id: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  let hex = secretStore.get(extSecretName(id))
  if (!hex) {
    hex = randomBytes(32).toString('hex')
    secretStore.set(extSecretName(id), hex)
  }
  return hex
}

/** Drop a removed extension's secret key (called on uninstall, before the data dir). */
export function deleteExtSecretKey(id: string): void {
  secretStore.delete(extSecretName(id))
}
