import type { GarretError } from './errors'

// ── streaming contract ────────────────────────────────────────────────────────────────────────
declare const STREAM_BRAND: unique symbol
/**
 * Declare a streaming method in your `Api`: its return type is `Stream<Chunk, Result>`. The host
 * produces it with `ctx.stream(...)`; the UI consumes it as a {@link StreamCall}. `Result` defaults
 * to `void` (bounded streams may return a final value, e.g. an exit code).
 */
export interface Stream<Chunk, Result = void> {
  readonly [STREAM_BRAND]: [Chunk, Result]
}

/** The UI-side handle for a streaming method. Deliberately NOT thenable (can't await an endless
 *  stream). Chainable. */
export interface StreamCall<Chunk, Result = void> {
  onData(cb: (chunk: Chunk) => void): StreamCall<Chunk, Result>
  onEnd(cb: (result: Result) => void): StreamCall<Chunk, Result>
  onError(cb: (err: GarretError) => void): StreamCall<Chunk, Result>
  /** Abort the host's `signal` + kill any spawned children. */
  cancel(): void
  /** BOUNDED streams only — resolves on end, rejects on error. Awaiting an endless stream hangs. */
  result(): Promise<Result>
}

// ── the typed client shape derived from an Api ──────────────────────────────────────────────────
/** Maps each Api method to its client form: `Stream<…>` → `StreamCall`, else `Promise`. */
export type HostClient<Api> = {
  [K in keyof Api]: Api[K] extends (...args: infer A) => infer R
    ? R extends Stream<infer C, infer Res>
      ? (...args: A) => StreamCall<C, Res>
      : (...args: A) => Promise<Awaited<R>>
    : never
}

/** Event payload map: `{ changed: { dir: string } }` → typed `on('changed', p => …)`. */
export type EventMap = Record<string, unknown>

// ── capabilities + manifest ──────────────────────────────────────────────────────────────────────
/** Declared in the manifest; drives the tier + the main-process broker's allowlist. System caps
 *  (`process`/`fs`/`native`) and wildcard network require a host (full-access tier). */
export type Capability =
  | 'storage'
  | 'secrets'
  | 'notify'
  | 'clipboard'
  | 'openExternal'
  | `network:${string}`
  | `service:${string}`
  | 'process'
  | 'fs'
  | 'native'

export type ConfigFieldType = 'string' | 'number' | 'boolean'
export interface ConfigField {
  type: ConfigFieldType
  label: string
  default: string | number | boolean
  min?: number
  max?: number
}
export type ConfigSchema = Record<string, ConfigField>

export interface Manifest {
  /** lowercase [a-z0-9._-], no "..". Directory + origin. */
  id: string
  name: string
  version: string
  apiVersion?: number
  description?: string
  /** lucide icon name. */
  icon?: string
  /** bundled preview image path. */
  preview?: string
  /** built UI dir (contains index.html). Required. */
  ui: string
  /** built Node host entry. Presence + a system capability ⇒ full-access tier. */
  host?: string
  capabilities?: Capability[]
  defaultSize?: { w: number; h: number }
  minSize?: { w: number; h: number }
  config?: ConfigSchema
}

/** Identity helper for `garret.manifest.ts` — pure passthrough, just for autocomplete + checking. */
export function defineManifest(manifest: Manifest): Manifest {
  return manifest
}

/** Identity helper for a config schema — infers the settings value type for `useConfig<T>()`. */
export function defineConfig<T extends ConfigSchema>(schema: T): T {
  return schema
}
