// Single source of truth lives in garret-core (shared with the widget SDK). Re-export
// so host code keeps importing from '@shared/types/poll' while the shapes can't drift.
export type { NotifySpec, WatchSpec, PollUpdate } from 'garret-core'
