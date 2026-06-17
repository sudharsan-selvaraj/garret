import { useEffect, useState } from 'react'
import type { WatchOptions } from '@shared/ipc/channels'

/**
 * Watch one or more file paths and get a version number that increments whenever
 * anything under them changes (debounced in main). Reusable by any file-based
 * widget — e.g. re-read git status, reload a config file, tail a log.
 *
 *   const v = useFileWatch(repoPath, { recursive: true, ignore: ['/node_modules/'] })
 *   // pass `v` into usePolledQuery's refreshToken, or re-run an effect on change
 */
export function useFileWatch(paths: string | string[], opts?: WatchOptions): number {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean)
  const dep = JSON.stringify([list, opts])
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (list.length === 0) return
    const watchId = crypto.randomUUID()
    const off = window.garret.watch.onEvent((id) => {
      if (id === watchId) setVersion((v) => v + 1)
    })
    window.garret.watch.subscribe(watchId, list, opts ?? {})
    return () => {
      off()
      window.garret.watch.unsubscribe(watchId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep])

  return version
}
