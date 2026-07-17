import type { ComponentType } from 'react'

/**
 * The renderer's slim widget-model — what the board/registry/host need to place a widget. Packs
 * (gx:) are adapted into this shape by ext/loader. (Relocated from the former internal @sdk, now
 * removed; packs author against the published @garretapp/sdk instead.)
 */

/** A widget icon: an emoji/text string or a React icon component (e.g. lucide). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WidgetIconType = string | ComponentType<any>

export interface WidgetManifest {
  id: string
  name: string
  icon?: WidgetIconType
  description?: string
  /** Default placement size, in grid units. */
  defaultSize: { w: number; h: number }
  minSize?: { w: number; h: number }
  /** Declarative config defaults. Packs render their own settings, so this is usually empty. */
  configSchema?: Record<string, { default?: unknown; type?: string }>
  capabilities?: { headless?: boolean }
}

/** Per-instance context handed to a widget's render fn. */
export interface WidgetContext {
  instanceId: string
}

export interface WidgetRenderProps<C = Record<string, unknown>> {
  config: C
  ctx: WidgetContext
}

export interface WidgetPlugin<C = Record<string, unknown>> {
  apiVersion?: number
  manifest: WidgetManifest
  render: ComponentType<WidgetRenderProps<C>>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWidgetPlugin = WidgetPlugin<any>

/** Default config object derived from a schema's `default`s / empty values. */
export function defaultConfig(schema?: WidgetManifest['configSchema']): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (schema) {
    for (const [key, f] of Object.entries(schema)) out[key] = f.default ?? (f.type === 'boolean' ? false : '')
  }
  return out
}
