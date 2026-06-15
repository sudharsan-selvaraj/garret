import type { WidgetPlugin } from './types'

export * from './types'
export * from './fields'
export * from './services'
export * from './poll'
export type { NotifySpec, WatchSpec, PollUpdate } from '@shared/types/poll'

/** Identity helper that pins the generic config type for a plugin definition. */
export function defineWidget<C = Record<string, unknown>>(plugin: WidgetPlugin<C>): WidgetPlugin<C> {
  return plugin
}
