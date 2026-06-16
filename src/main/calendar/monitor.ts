import { Notification, shell } from 'electron'
import { persistence } from '@main/persistence/store'
import { googleService } from '@main/services/google'
import type { CalendarEvent } from '@shared/types/calendar'

// Background calendar watcher (independent of any placed widget): detects new /
// cancelled meetings by diffing a bounded "next 7 days" window each tick, and
// schedules precise per-event "starting soon" reminders via timers. The Calendar
// API is free (quota only), and each tick is a single small events.list call.

const WINDOW = { range: 'week', maxResults: 100 }

let timer: ReturnType<typeof setInterval> | null = null
// id → event of the last seen window; null = not yet seeded (don't notify on first run).
let known: Map<string, CalendarEvent> | null = null
const reminderTimers = new Map<string, ReturnType<typeof setTimeout>>()
const reminded = new Set<string>()

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function notify(title: string, body: string, url?: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  if (url && /^https?:\/\//i.test(url)) n.on('click', () => void shell.openExternal(url))
  n.show()
}

function clearReminders(): void {
  for (const t of reminderTimers.values()) clearTimeout(t)
  reminderTimers.clear()
}

async function tick(): Promise<void> {
  const prefs = persistence.getPreferences()
  const wantChanges = prefs.calendarNotifyChanges
  const lead = (prefs.calendarRemindBefore ?? 0) * 60_000
  if (!wantChanges && lead <= 0) return

  const status = await googleService.status()
  if (!status.connected) {
    known = null // re-seed silently after a reconnect
    return
  }

  let events: CalendarEvent[]
  try {
    events = (await googleService.query('listUpcomingEvents', WINDOW)) as CalendarEvent[]
  } catch {
    return // transient (API/network) — try next tick
  }

  const now = Date.now()
  const current = new Map(events.map((e) => [e.id, e]))

  // ---- new / cancelled detection ----
  if (wantChanges) {
    if (known === null) {
      known = current // seed; don't fire for pre-existing events
    } else {
      for (const [id, e] of current) {
        if (!known.has(id)) {
          const when = e.allDay ? '' : ` · ${fmtTime(e.start)}`
          notify('New meeting', `${e.title}${when}`, e.url)
        }
      }
      for (const [id, e] of known) {
        if (!current.has(id) && new Date(e.start).getTime() > now) {
          notify('Meeting cancelled', e.title, e.url)
        }
      }
      known = current
    }
  } else {
    known = null
  }

  // ---- reminders (reschedule from fresh data each tick) ----
  clearReminders()
  // Forget reminders for events no longer present.
  for (const id of [...reminded]) if (!current.has(id)) reminded.delete(id)

  if (lead > 0) {
    for (const e of events) {
      if (e.allDay) continue
      const startMs = new Date(e.start).getTime()
      if (startMs <= now || reminded.has(e.id)) continue
      const fireIn = Math.max(0, startMs - lead - now)
      const t = setTimeout(() => {
        reminded.add(e.id)
        reminderTimers.delete(e.id)
        const mins = Math.round((new Date(e.start).getTime() - Date.now()) / 60_000)
        const title = mins <= 0 ? 'Meeting starting now' : `Meeting in ${mins} min`
        notify(title, e.title, e.joinUrl || e.url)
      }, fireIn)
      reminderTimers.set(e.id, t)
    }
  }
}

/** Start (or restart) the monitor from current preferences. Idle if nothing enabled. */
export function startCalendarMonitor(): void {
  stopCalendarMonitor()
  const prefs = persistence.getPreferences()
  if (!prefs.calendarNotifyChanges && (prefs.calendarRemindBefore ?? 0) <= 0) return
  const intervalMs = Math.max(1, prefs.calendarSyncMin || 5) * 60_000
  void tick()
  timer = setInterval(() => void tick(), intervalMs)
}

export function stopCalendarMonitor(): void {
  if (timer) clearInterval(timer)
  timer = null
  clearReminders()
}
