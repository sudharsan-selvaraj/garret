/** Options for the file watcher (passed by file-based widgets). */
export interface WatchOptions {
  recursive?: boolean
  /** Skip events whose path contains any of these substrings (e.g. '/node_modules/'). */
  ignore?: string[]
  debounceMs?: number
}
