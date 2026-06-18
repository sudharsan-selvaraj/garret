/**
 * Poll / notification data shapes. These cross the host↔widget boundary (and, for
 * sandboxed widgets, the postMessage bridge), so they are plain serializable types.
 */

/** How to extract notification fields from a result item (dot-paths into the item). */
export interface NotifySpec {
  idPath: string
  titlePath: string
  urlPath?: string
  /** Path to an ISO timestamp; enables high-water-mark dedupe (preferred). */
  createdPath?: string
}

/** A background notification watch: a persistent poll subscriber that fires on new items. */
export interface WatchSpec {
  watchId: string
  serviceId: string
  method: string
  params: Record<string, unknown>
  notify: NotifySpec
  /** Shown as the notification title (e.g. "New ticket"). */
  label: string
}

/** A poll result pushed to the renderer (or returned from subscribe). */
export interface PollUpdate {
  key: string
  data?: unknown
  error?: string
  /** Epoch ms of the last successful fetch (0 if never). */
  ts: number
}
