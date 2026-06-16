import type { ComponentType } from 'react'
import type { ConfigSchema } from './fields'
import type { NotifySpec } from '@shared/types/poll'

/** A widget icon: either an emoji/text string or a React icon component (e.g. lucide). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WidgetIconType = string | ComponentType<any>

/**
 * A service that a group of widgets belongs to (Jira, Bitbucket, Google, …).
 * Its connection must be configured + validated once before its widgets can be
 * added. The connection form is generated from `connectionSchema` (password
 * fields are treated as secrets and stored encrypted in main).
 */
export interface ServiceDefinition {
  id: string
  name: string
  icon?: WidgetIconType
  description?: string
  connectionSchema: ConfigSchema
  /** If true, widgets in this group require a validated connection to be added. */
  requiresConnection: boolean
}

/** Static description of a widget type. */
export interface WidgetManifest {
  /** Unique plugin id, e.g. 'google-calendar'. */
  id: string
  name: string
  icon?: WidgetIconType
  description?: string
  /** Service group this widget belongs to. Omit for serviceless ("General") widgets. */
  serviceId?: string
  /** Default placement size, in grid units. */
  defaultSize: { w: number; h: number }
  minSize?: { w: number; h: number }
  /** Declarative config — drives the auto-generated settings form + validation. */
  configSchema: ConfigSchema
  capabilities?: {
    /** Show a refresh button in the widget header. */
    refreshable?: boolean
    /**
     * Render without header chrome (no title bar / ⋯ button) for a clean object
     * on the desktop — e.g. a clock. Settings/lock/color/remove stay reachable via
     * the right-click context menu, and the whole card becomes the drag handle.
     */
    headless?: boolean
  }
  /**
   * Background notification support. `poll(config)` returns the query to watch
   * (or null if the instance isn't ready); `notifySpec` says how to read each item.
   * The framework registers a main-side watch when the instance's config opts in.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  poll?: (config: any) => { method: string; params: Record<string, unknown> } | null
  notifySpec?: NotifySpec
}

/**
 * Per-instance runtime context handed to a widget's render/settings components.
 * This is the customization surface: persistent storage, refresh signal, and the
 * ability to mutate the instance's own config (e.g. after an auth flow).
 */
export interface WidgetContext {
  instanceId: string
  /** Persistent, per-instance key/value storage (tokens, cursors, cache). */
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
  }
  /** Increments when the user hits refresh; render may watch it. */
  refreshToken: number
  /** Patch this instance's config — persisted by the framework. */
  updateConfig(patch: Record<string, unknown>): void
}

export interface WidgetRenderProps<C = Record<string, unknown>> {
  config: C
  ctx: WidgetContext
}

export interface WidgetSettingsProps<C = Record<string, unknown>> {
  config: C
  ctx: WidgetContext
  onChange(patch: Partial<C>): void
}

/**
 * A widget plugin. The only hard requirement is a manifest + a render component.
 * `Settings` is the escape hatch for custom config UI / auth flows / custom code —
 * when omitted, the framework auto-generates a form from `manifest.configSchema`.
 */
export interface WidgetPlugin<C = Record<string, unknown>> {
  manifest: WidgetManifest
  render: ComponentType<WidgetRenderProps<C>>
  Settings?: ComponentType<WidgetSettingsProps<C>>
}

/**
 * Type-erased plugin for storage in the registry. Specific `WidgetPlugin<C>`
 * components are not mutually assignable (config variance), so the registry and
 * built-ins list hold this erased form; the per-instance config is validated at
 * the schema boundary instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWidgetPlugin = WidgetPlugin<any>
