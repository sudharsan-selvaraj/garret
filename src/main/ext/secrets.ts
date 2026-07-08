import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { GarretError } from '@garretapp/sdk'
import { extSecretKeyHex } from '@main/ext/keys'

/**
 * Per-widget encrypted secret store — the single source of truth for BOTH paths that touch it: the
 * capability broker (`g.secrets.*` from a bound guest) and the settings pane (a `type:"secret"` field,
 * written main-side). Same file (`<widget data dir>/secrets.json`), same AES-256-GCM box, same
 * per-widget key (`extSecretKeyHex(fullId)`), so a token saved in Settings decrypts for the widget.
 *
 * Callers pass the widget's data dir (avoids a cycle with install.ts, which owns widgetDataDir).
 */
interface SecretBox {
  v: 1
  iv: string
  tag: string
  ct: string
}

function secretsFile(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'secrets.json')
}
function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
function writeAtomic(file: string, obj: Record<string, unknown>): void {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(obj))
  renameSync(tmp, file)
}
function key(fullId: string): Buffer {
  const hex = extSecretKeyHex(fullId)
  if (!hex) throw new GarretError('UNAVAILABLE', 'secrets unavailable on this platform')
  return Buffer.from(hex, 'hex')
}

export function getSecret(dir: string, fullId: string, name: string): string | undefined {
  const box = readJson(secretsFile(dir))[name] as SecretBox | undefined
  if (!box) return undefined
  const d = createDecipheriv('aes-256-gcm', key(fullId), Buffer.from(box.iv, 'base64'))
  d.setAuthTag(Buffer.from(box.tag, 'base64'))
  try {
    return d.update(Buffer.from(box.ct, 'base64')).toString('utf8') + d.final('utf8')
  } catch {
    throw new GarretError('INTERNAL', 'secret failed to decrypt')
  }
}
export function setSecret(dir: string, fullId: string, name: string, value: string): void {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(fullId), iv)
  const ct = Buffer.concat([c.update(String(value), 'utf8'), c.final()])
  const box: SecretBox = {
    v: 1,
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    ct: ct.toString('base64')
  }
  const file = secretsFile(dir)
  const all = readJson(file)
  all[name] = box
  writeAtomic(file, all)
}
export function deleteSecret(dir: string, name: string): void {
  const file = secretsFile(dir)
  const all = readJson(file)
  delete all[name]
  writeAtomic(file, all)
}
/** Names of secrets that have a value (never the plaintext) — lets the settings pane show "saved". */
export function secretKeys(dir: string): string[] {
  return Object.keys(readJson(secretsFile(dir)))
}
