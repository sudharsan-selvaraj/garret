// garret-widget-sdk — the author-facing package. Re-exports the pure core, plus
// createSDK (hook logic bound per realm) and shared UI. Widget authors install this.
export * from 'garret-core'
export { createSDK } from './createSDK'
export type { GarretSDK, ReactApi, PolledState, ServiceStatusState } from './createSDK'
export { WidgetStatus } from './WidgetStatus'
