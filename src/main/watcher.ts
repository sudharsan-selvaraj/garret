import { watch, type FSWatcher } from 'node:fs'
import { webContents } from 'electron'
import { Channels, type WatchOptions } from '@shared/ipc/channels'

/**
 * File-system watch subsystem (the event-driven counterpart to the poll
 * scheduler). Widgets subscribe to paths; on any change we debounce and notify
 * the renderer, which re-reads whatever it needs. Generic — reused by any
 * file-based widget via the SDK `useFileWatch` hook.
 */
interface Sub {
  watchers: FSWatcher[]
  wcId: number
  timer: NodeJS.Timeout | null
}

const subs = new Map<string, Sub>()

export function subscribeWatch(
  watchId: string,
  paths: string[],
  wcId: number,
  opts: WatchOptions
): void {
  unsubscribeWatch(watchId) // replace if re-subscribing

  const ignore = opts.ignore ?? []
  const debounceMs = opts.debounceMs ?? 400
  const sub: Sub = { watchers: [], wcId, timer: null }

  const fire = (): void => {
    if (sub.timer) clearTimeout(sub.timer)
    sub.timer = setTimeout(() => {
      sub.timer = null
      webContents.fromId(wcId)?.send(Channels.watchEvent, watchId)
    }, debounceMs)
  }

  for (const p of paths) {
    try {
      const w = watch(p, { recursive: opts.recursive ?? true }, (_event, filename) => {
        const f = String(filename ?? '')
        if (ignore.some((ig) => f.includes(ig))) return
        fire()
      })
      w.on('error', () => {})
      sub.watchers.push(w)
    } catch {
      /* path missing / unwatchable — skip */
    }
  }
  subs.set(watchId, sub)
}

export function unsubscribeWatch(watchId: string): void {
  const sub = subs.get(watchId)
  if (!sub) return
  if (sub.timer) clearTimeout(sub.timer)
  for (const w of sub.watchers) {
    try {
      w.close()
    } catch {
      /* already closed */
    }
  }
  subs.delete(watchId)
}

export function teardownWatchSender(wcId: number): void {
  for (const [id, sub] of [...subs]) {
    if (sub.wcId === wcId) unsubscribeWatch(id)
  }
}
