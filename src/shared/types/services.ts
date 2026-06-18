// Single source of truth lives in garret-core (shared with the widget SDK). Re-export
// so host code keeps importing from '@shared/types/services' while the shape can't drift.
export type { ServiceStatus } from 'garret-core'
