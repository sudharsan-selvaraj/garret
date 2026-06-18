// garret-widget-sdk — the author-facing package. Re-exports the pure core, plus
// createSDK (hook logic bound per realm) and shared UI. Widget authors install this.
// GarretSDK / PolledState / ServiceStatusState are defined in garret-core (so render
// props can reference them) and re-exported via `export * from 'garret-core'`.
export * from 'garret-core'
export { createSDK } from './createSDK'
export type { ReactApi } from './createSDK'
export { WidgetStatus } from './WidgetStatus'
